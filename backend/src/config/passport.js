const { Strategy: JwtStrategy } = require('passport-jwt');

const User = require('../models/user.model');

// Reads the JWT from the httpOnly `accessToken` cookie set at login, rather
// than the default Authorization header — cookie-parser must run before
// passport.initialize() so req.cookies is populated.
function cookieExtractor(req) {
  if (req && req.cookies) {
    return req.cookies.accessToken || null;
  }
  return null;
}

// secretOrKeyProvider (rather than a plain secretOrKey) defers reading
// JWT_SECRET to verification time instead of strategy-construction time.
// JwtStrategy's constructor throws synchronously if secretOrKey is falsy,
// which broke module load (and therefore every route, including /health)
// in any process that requires app.js before JWT_SECRET is set in env
// (e.g. tests that don't touch auth at all).
const jwtStrategyOptions = {
  jwtFromRequest: cookieExtractor,
  secretOrKeyProvider: (request, rawJwtToken, done) => {
    done(null, process.env.JWT_SECRET);
  },
};

function configurePassport(passport) {
  passport.use(
    new JwtStrategy(jwtStrategyOptions, async (payload, done) => {
      try {
        const user = await User.findById(payload.id);

        if (!user) {
          return done(null, false);
        }

        // user is a full Mongoose document here; req.user will still
        // serialize safely because the schema's toJSON transform strips
        // passwordHash on any res.json(...) call.
        return done(null, user);
      } catch (error) {
        return done(error, false);
      }
    })
  );
}

module.exports = configurePassport;
