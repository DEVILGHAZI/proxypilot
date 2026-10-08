export function createConfig(tseslint) {
  return tseslint.config(
    {
      ignores: ["dist/**", ".next/**", "node_modules/**", "coverage/**"],
    },
    ...tseslint.configs.recommended,
    {
      rules: {
        "@typescript-eslint/consistent-type-imports": [
          "error",
          { prefer: "type-imports", fixStyle: "separate-type-imports" },
        ],
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
      },
    },
  );
}
