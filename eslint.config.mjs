import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".next-engine/**",
      "out/**",
      "build/**",
      "tmp/**",
      "desktop/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
