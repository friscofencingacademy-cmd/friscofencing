import { render, screen, fireEvent } from '@testing-library/react';

import LoadError from '../LoadError';

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

  it('calls onRetry when the "Try again" button is clicked', () => {
    const onRetry = jest.fn();
    render(<LoadError message="Failed" onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
