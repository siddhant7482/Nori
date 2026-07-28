import { handlers } from "@/lib/auth";

// argon2 is a native module and Prisma needs a real Node runtime.
export const runtime = "nodejs";

export const { GET, POST } = handlers;
