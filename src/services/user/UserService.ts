/**
 * UserService
 *
 * Manages users (staff) within a restaurant tenant.
 * Every method receives restaurantId explicitly — never queries across tenants.
 */

import { hash, compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { serviceOk, serviceFail, ServiceResult } from "@/types";
import type {
  CreateUserInput,
  UpdateUserInput,
  ChangePasswordInput,
} from "@/validators/user";
import type { User, Prisma } from "@prisma/client";

export type UserPublic = Omit<User, "password">;

export class UserService {
  /**
   * List all users for a restaurant (excludes passwords).
   */
  static async list(restaurantId: string): Promise<ServiceResult<UserPublic[]>> {
    const rawUsers = await prisma.user.findMany({
      where: { restaurantId },
      orderBy: { createdAt: "asc" },
    });

    const users = rawUsers.map(({ password: _pwd, ...u }) => u);
    return serviceOk(users);
  }

  /**
   * Get a single user by id, scoped to the tenant.
   */
  static async getById(
    restaurantId: string,
    userId: string
  ): Promise<ServiceResult<UserPublic>> {
    const rawUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!rawUser || rawUser.restaurantId !== restaurantId) {
      return serviceFail("User not found", 404);
    }

    const { password: _pwd, ...user } = rawUser;
    return serviceOk(user);
  }

  /**
   * Create a new user (staff member) within the tenant.
   */
  static async create(
    restaurantId: string,
    input: CreateUserInput
  ): Promise<ServiceResult<UserPublic>> {
    const existing = await prisma.user.findUnique({
      where: {
        email_restaurantId: { email: input.email, restaurantId },
      },
      select: { id: true },
    });

    if (existing) {
      return serviceFail(
        "A user with this email already exists in this restaurant.",
        409
      );
    }

    const hashedPassword = await hash(input.password, 12);

    const rawUser = await prisma.user.create({
      data: {
        restaurantId,
        name: input.name,
        email: input.email,
        password: hashedPassword,
        role: input.role,
      },
    });

    const { password: _pwd, ...user } = rawUser;
    return serviceOk(user);
  }

  /**
   * ⭐ NENHUM RESTAURANTE PODE FICAR SEM NENHUM DONO ATIVO.
   *
   * ─── O QUE FALTAVA, e o que isso abria ──────────────────────────────────
   * Nem `update` nem `deactivate` liam o papel do alvo antes de escrever. Três
   * chamadas comuns esvaziavam o quadro de donos de uma loja:
   *
   *   PATCH /api/users/:id  { isActive: false }   num OWNER ativo
   *   PATCH /api/users/:id  { role: "STAFF"   }   num OWNER ativo
   *   DELETE /api/users/:id                       num OWNER ativo
   *
   * Qualquer MANAGER logado fazia as três. A única trava que existia — "você não
   * pode desativar a própria conta" — não pegava nenhuma delas, e o próprio dono
   * ainda se derrubava com o PATCH, que não tinha nem essa.
   *
   * Isso é ruim sozinho: um gerente tranca o dono para fora da loja dele. E é
   * pior acompanhado — é exatamente o gatilho que abre a porta pública do
   * `/api/recover`, que cria conta de OWNER em restaurante ativo SEM dono.
   *
   * ─── A REGRA JÁ EXISTIA NESTA CASA, para os outros ──────────────────────
   * O RH da Foocci recusa cortar o último CEO ativo — "trancar a casa por fora
   * com todo mundo lá dentro" (`src/security/routeGuards.test.ts:104`). A mesma
   * regra não valia para os donos dos restaurantes, que são os clientes.
   *
   * ─── POR QUE `FOR UPDATE`, e não um `count()` ───────────────────────────
   * Com dois donos e duas requisições ao mesmo tempo, cada uma derrubando um, um
   * `count` em READ COMMITTED vê o outro ainda ativo — as duas passam, e a loja
   * fica sem dono nenhum. O `FOR UPDATE` tranca as linhas de dono do restaurante
   * até o fim da transação, então a segunda espera e enxerga o mundo já mudado.
   *
   * @returns `true` quando a mudança deixaria a loja sem dono ativo.
   */
  private static async deixariaALojaSemDono(
    tx: Prisma.TransactionClient,
    restaurantId: string,
    alvoId: string,
    mudanca: { isActive?: boolean; role?: string },
  ): Promise<boolean> {
    const tiraODono =
      mudanca.isActive === false || (mudanca.role !== undefined && mudanca.role !== "OWNER");
    if (!tiraODono) return false;

    const donosAtivos = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users
      WHERE "restaurantId" = ${restaurantId}
        AND role::text = 'OWNER'
        AND "isActive" = true
      FOR UPDATE
    `;

    const oAlvoEDonoAtivo = donosAtivos.some((d) => d.id === alvoId);
    return oAlvoEDonoAtivo && donosAtivos.length === 1;
  }

  /**
   * Update a user's mutable fields.
   * Password changes go through changePassword() instead.
   */
  static async update(
    restaurantId: string,
    userId: string,
    input: UpdateUserInput
  ): Promise<ServiceResult<UserPublic>> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, restaurantId: true },
    });

    if (!user || user.restaurantId !== restaurantId) {
      return serviceFail("User not found", 404);
    }

    const resultado = await prisma.$transaction(async (tx) => {
      if (await this.deixariaALojaSemDono(tx, restaurantId, userId, input)) return null;

      return tx.user.update({
        where: { id: userId },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.role !== undefined && { role: input.role }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
        },
      });
    });

    if (!resultado) {
      return serviceFail(
        "Este é o único dono ativo do restaurante. Promova outra pessoa a dono antes de tirar o acesso deste.",
        400,
      );
    }

    const { password: _pwd, ...updated } = resultado;
    return serviceOk(updated);
  }

  /**
   * Change password with current password verification.
   */
  static async changePassword(
    restaurantId: string,
    userId: string,
    input: ChangePasswordInput
  ): Promise<ServiceResult<{ message: string }>> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, restaurantId: true, password: true },
    });

    if (!user || user.restaurantId !== restaurantId) {
      return serviceFail("User not found", 404);
    }

    const isValid = await compare(input.currentPassword, user.password);
    if (!isValid) {
      return serviceFail("Current password is incorrect", 400);
    }

    const hashedPassword = await hash(input.newPassword, 12);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return serviceOk({ message: "Password changed successfully" });
  }

  /**
   * Soft-delete: deactivate instead of destroying the record.
   * Preserves referential integrity for orders, messages, etc.
   */
  static async deactivate(
    restaurantId: string,
    userId: string,
    requestingUserId: string
  ): Promise<ServiceResult<{ message: string }>> {
    if (userId === requestingUserId) {
      return serviceFail("You cannot deactivate your own account", 400);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, restaurantId: true, role: true },
    });

    if (!user || user.restaurantId !== restaurantId) {
      return serviceFail("User not found", 404);
    }

    const desativado = await prisma.$transaction(async (tx) => {
      if (await this.deixariaALojaSemDono(tx, restaurantId, userId, { isActive: false })) {
        return false;
      }
      await tx.user.update({ where: { id: userId }, data: { isActive: false } });
      return true;
    });

    if (!desativado) {
      return serviceFail(
        "Este é o único dono ativo do restaurante. Promova outra pessoa a dono antes de tirar o acesso deste.",
        400,
      );
    }

    return serviceOk({ message: "User deactivated" });
  }
}
