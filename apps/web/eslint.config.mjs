import tseslint from "typescript-eslint";
import { createConfig } from "../../infrastructure/eslint/base.mjs";

export default [{ ignores: ["next-env.d.ts"] }, ...createConfig(tseslint)];
