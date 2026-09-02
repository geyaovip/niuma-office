import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type AppearancePreference = "system" | "light" | "dark";
export interface DesktopPreferences { appearance: AppearancePreference }

export class PreferencesRepository {
  private readonly file: string;

  constructor(root: string) { this.file = join(root, "data", "preferences.json"); }

  async get(): Promise<DesktopPreferences> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Partial<DesktopPreferences>;
      return { appearance: isAppearance(parsed.appearance) ? parsed.appearance : "system" };
    } catch { return { appearance: "system" }; }
  }

  async save(input: unknown): Promise<DesktopPreferences> {
    const value = input && typeof input === "object" ? (input as Partial<DesktopPreferences>).appearance : undefined;
    if (!isAppearance(value)) throw new Error("外观设置无效");
    const preferences = { appearance: value };
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(preferences, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.file);
    return preferences;
  }
}

function isAppearance(value: unknown): value is AppearancePreference {
  return value === "system" || value === "light" || value === "dark";
}
