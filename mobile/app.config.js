const baseConfig = require('./app.json');

// APP_VARIANT is set per EAS build profile (see eas.json's "development" profile)
// and can be set locally in mobile/.env for `expo start --dev-client` / `expo run:ios`.
// A distinct bundle identifier + scheme means a dev-client build installs as its own
// app icon alongside the TestFlight build, instead of overwriting it (they'd otherwise
// collide since iOS treats matching bundle IDs as the same app).
const IS_DEV = process.env.APP_VARIANT === 'development';

module.exports = () => {
  const expo = { ...baseConfig.expo };

  if (IS_DEV) {
    expo.name = 'Subway Quest (Dev)';
    expo.scheme = 'subwayquest-dev';
    expo.ios = {
      ...expo.ios,
      bundleIdentifier: 'com.transitapps.subwayquest.dev',
    };
  }

  return { expo };
};
