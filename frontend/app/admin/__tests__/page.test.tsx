const redirectMock = jest.fn();

jest.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

import AdminIndexPage from '../page';

describe('AdminIndexPage', () => {
  it('redirects to /admin/dashboard', () => {
    AdminIndexPage();

    expect(redirectMock).toHaveBeenCalledWith('/admin/dashboard');
  });
});
