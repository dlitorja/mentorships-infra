import js from "@eslint/js";
import globals from "globals";
import nextPlugin from "@next/eslint-plugin-next";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";

export default [
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      "@next/next": nextPlugin,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      "@typescript-eslint": typescriptEslint,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactPlugin.configs.recommended.rules,
      // Don't use recommended rules - configure manually to avoid strict rules
      "react-hooks/rules-of-hooks": "error", // Keep this as error (critical)
      "react-hooks/exhaustive-deps": "warn", // Make this a warning
      // Override rules
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "no-undef": "off", // TypeScript handles this - must be after spreading configs
      "@typescript-eslint/no-unused-vars": [
        "warn", // Make unused vars warnings instead of errors
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "react-hooks/exhaustive-deps": "warn", // Allow some React hooks issues
      "react-hooks/rules-of-hooks": "error", // Keep this as error (critical)
      "react-hooks/purity": "off", // Disable purity checks (too strict)
      "@next/next/no-html-link-for-pages": "warn", // Allow <a> tags in some cases
      "no-unused-vars": "off", // Use TypeScript version instead
      "react/no-unescaped-entities": "warn", // Allow quotes in JSX
      "no-useless-escape": "warn", // Allow escape characters
      "@next/next/no-img-element": "warn", // Allow img elements
      "react-hooks/error-boundaries": "off", // Allow JSX in try/catch (we use error boundaries elsewhere)
    },
  },
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "node_modules/**",
      ".turbo/**",
    ],
  },
];

