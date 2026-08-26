/**
 * Declare that this suite exercises a shop that SELLS.
 *
 * Imported FIRST, before anything that reaches config/env.js, because that
 * module reads process.env once at import and ES module imports are hoisted —
 * an assignment in the test's own body runs too late to be seen. A suite using
 * dynamic imports can set the variable inline; these cannot.
 *
 * Why it is needed at all: the launch gate's default changed. With no
 * LAUNCH_DATE and no LAUNCH_MODE, a shop that has never taken a payment refuses
 * orders — which is the whole point, and a fresh test database is by definition
 * such a shop. Declaring the intent here beats giving the gate a special case
 * for tests, because then the production behaviour is the behaviour under test
 * everywhere else.
 */
process.env.LAUNCH_MODE ||= 'open';
