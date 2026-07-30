export function isolatedChildEnv(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key, value]) => {
      return !key.startsWith("HERDR_") && value !== undefined;
    }),
  );
}
