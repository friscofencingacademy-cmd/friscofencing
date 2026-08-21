// Brings @testing-library/jest-dom's custom matcher types (toBeInTheDocument,
// toHaveTextContent, toBeChecked, etc.) into scope for tsc — without this,
// every test file using those matchers fails `tsc --noEmit` even though the
// matchers work fine at runtime (jest.setup.js already registers them via
// `require('@testing-library/jest-dom')`). This file only affects the type
// checker; it has no runtime effect.
import '@testing-library/jest-dom';
