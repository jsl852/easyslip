import type { Workspace } from "$lib/types";

declare global {
  namespace App {
    interface Locals {
      workspace?: Workspace;
    }
  }
}

declare module "@auth/core/types" {
  interface Session {
    user: {
      id: string;
    } & import("@auth/core/types").DefaultSession["user"];
  }
}

export {};
