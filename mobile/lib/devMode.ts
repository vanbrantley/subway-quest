// mobile/lib/devMode.ts
// The one place EXPO_PUBLIC_DEV_MODE gets read -- everything else imports
// IS_DEV_MODE from here rather than reading process.env directly, so there's
// exactly one source of truth for "is this a dev-mode build." Set locally
// via mobile/.env (EXPO_PUBLIC_DEV_MODE=true, gitignored, never committed);
// set per EAS build profile via eas.json's `env` block (production is
// always "false", baked in at build time, not a runtime toggle). See
// docs/data-layer.md's "Dev/prod data separation" for the full design.
export const IS_DEV_MODE = process.env.EXPO_PUBLIC_DEV_MODE === 'true';
