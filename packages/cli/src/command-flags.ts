// SPDX-License-Identifier: Apache-2.0

export interface CommandFlagSpec {
  value: readonly string[];
  boolean: readonly string[];
}

export interface ParsedCommandFlags {
  args: string[];
  flags: Record<string, string>;
}

export const COMMAND_FLAG_SPECS = {
  init: { value: ["dir", "name"], boolean: [] },
  export: {
    value: ["project", "store-specs", "out", "screen", "size", "platform", "device", "locale", "layout", "profile", "browser"],
    boolean: [],
  },
  screen: {
    value: ["project", "store-specs", "platform", "device", "locale", "id", "name", "direction", "size", "to", "layout", "from", "background"],
    boolean: ["cascade", "json"],
  },
  dev: { value: ["project", "store-specs", "port"], boolean: [] },
  import: { value: ["project", "store-specs", "layout"], boolean: ["refresh"] },
  font: { value: ["project", "weight", "google", "family"], boolean: [] },
  theme: { value: ["project", "layout"], boolean: ["built-in"] },
  locale: { value: ["project", "from", "direction", "to", "layout"], boolean: [] },
  asset: { value: ["project", "threshold", "background", "tolerance"], boolean: [] },
  layout: { value: ["project", "name", "mode"], boolean: [] },
  setup: { value: [], boolean: [] },
  template: { value: ["project", "store-specs", "locale", "layout"], boolean: ["built-in", "pack"] },
  element: { value: ["project", "layout", "screen", "locale", "json", "type"], boolean: ["all-sizes"] },
} as const satisfies Record<string, CommandFlagSpec>;

export type CliCommand = keyof typeof COMMAND_FLAG_SPECS;

export function isCliCommand(command: string | undefined): command is CliCommand {
  return command !== undefined && Object.hasOwn(COMMAND_FLAG_SPECS, command);
}

export function parseCommandFlags(argv: string[], spec: CommandFlagSpec): ParsedCommandFlags {
  const valueOptions = new Set(spec.value);
  const booleanOptions = new Set(spec.boolean);
  const args: string[] = [];
  const flags: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--") {
      args.push(...argv.slice(index + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      args.push(arg);
      continue;
    }

    const option = arg.slice(2);
    if (booleanOptions.has(option)) {
      flags[option] = "true";
      continue;
    }
    if (!valueOptions.has(option)) {
      throw new Error(`Unknown option --${option}`);
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`--${option} requires a value`);
    }
    flags[option] = value;
    index += 1;
  }

  return { args, flags };
}
