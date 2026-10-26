import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import LoadError from '../LoadError';

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup();
});

describe('LoadError', () => {
  it('renders the default message and no retry button when onRetry is omitted', () => {
    render(<LoadError />);

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this — please try again.");
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders a custom message', () => {
    render(<LoadError message="Custom failure message" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Custom failure message');
  });

  it('calls onRetry when the "Try again" button is clicked', async () => {
    const onRetry = jest.fn();
    render(<LoadError message="Failed" onRetry={onRetry} />);

    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
