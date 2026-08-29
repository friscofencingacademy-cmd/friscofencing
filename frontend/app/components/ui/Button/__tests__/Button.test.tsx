import { render, screen, fireEvent } from '@testing-library/react';

import Button from '../Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);

    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('fires onClick when clicked', () => {
    const onClick = jest.fn();

    render(<Button onClick={onClick}>Click me</Button>);
    fireEvent.click(screen.getByText('Click me'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick when disabled', () => {
    const onClick = jest.fn();

    render(
      <Button onClick={onClick} disabled>
        Click me
      </Button>
    );
    fireEvent.click(screen.getByText('Click me'));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('shows a disabled state when loading', () => {
    render(<Button loading>Submit</Button>);

    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders an anchor tag when as="a" with the given href', () => {
    render(
      <Button as="a" href="/login">
        Log In
      </Button>
    );

    const link = screen.getByRole('link', { name: 'Log In' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/login');
  });

  it('renders the accent variant', () => {
    render(<Button variant="accent">Enroll in a Program</Button>);

    expect(screen.getByRole('button', { name: 'Enroll in a Program' })).toBeInTheDocument();
  });
});
