import type { CommandDef } from "./parser.js";

/**
 * Extra configuration modes and commands, contributed by routing protocols and later
 * features. Kept apart from ios.ts so that extensions can register without an import cycle.
 */
export interface CliExtension<Ctx = never> {
  /** Commands available in the given mode. */
  commands(mode: string): CommandDef<Ctx>[];
  /** Prompt suffix for custom modes, for example "(config-router)#". */
  prompt?(mode: string): string | undefined;
}

const list: CliExtension<unknown>[] = [];

export function registerCliExtension<Ctx>(e: CliExtension<Ctx>): void {
  list.push(e as unknown as CliExtension<unknown>);
}

export function cliExtensions(): readonly CliExtension<unknown>[] {
  return list;
}
