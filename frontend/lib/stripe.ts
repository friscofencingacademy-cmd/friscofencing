import { loadStripe } from '@stripe/stripe-js';

// A singleton promise per Stripe's own recommended pattern — loadStripe
// should be called once at module scope, not inside a component, so every
// import of this module shares the same in-flight/resolved load.
export default loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);
