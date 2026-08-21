import { render, screen } from '@testing-library/react';
import { Home, ClipboardList } from 'lucide-react';

import PortalLayout, { type PortalNavGroup, type PortalNavItem } from '../index';

let mockPathname = '/parent/dashboard';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

const HOME_ITEM: PortalNavItem = { key: 'home', label: 'Home', icon: <Home size={16} />, href: '/parent/dashboard' };
const REGISTER_ITEM: PortalNavItem = {
  key: 'register',
  label: 'Register',
  icon: <ClipboardList size={16} />,
  href: '/parent/register',
};

const NAV_GROUPS: PortalNavGroup[] = [
  { label: 'HOME', items: [HOME_ITEM] },
  { label: 'ACADEMY', items: [REGISTER_ITEM] },
];

const BOTTOM_NAV_ITEMS: PortalNavItem[] = [HOME_ITEM, REGISTER_ITEM];

beforeEach(() => {
  mockPathname = '/parent/dashboard';
});

describe('PortalLayout', () => {
  it('renders nav groups with their labels and items, plus children content', () => {
    render(
      <PortalLayout navGroups={NAV_GROUPS} bottomNavItems={BOTTOM_NAV_ITEMS}>
        <p>Page body</p>
      </PortalLayout>
    );

    expect(screen.getByText('HOME')).toBeInTheDocument();
    expect(screen.getByText('ACADEMY')).toBeInTheDocument();
    expect(screen.getByText('Page body')).toBeInTheDocument();
  });

  it('marks the sidebar link matching the current pathname as active', () => {
    mockPathname = '/parent/register';

    render(
      <PortalLayout navGroups={NAV_GROUPS} bottomNavItems={BOTTOM_NAV_ITEMS}>
        <p>Page body</p>
      </PortalLayout>
    );

    const sidebarLinks = screen.getAllByRole('link', { name: /register/i });
    // One in the sidebar, one in the bottom nav — the sidebar's should carry aria-current.
    expect(sidebarLinks.some((link) => link.getAttribute('aria-current') === 'page')).toBe(true);

    const homeLinks = screen.getAllByRole('link', { name: /^home$/i });
    expect(homeLinks.every((link) => !link.hasAttribute('aria-current'))).toBe(true);
  });

  it('renders custom group content in place of items', () => {
    const customGroups: PortalNavGroup[] = [
      { label: 'CHILDREN', content: <div data-testid="custom-content">Custom rows</div> },
    ];

    render(
      <PortalLayout navGroups={customGroups} bottomNavItems={BOTTOM_NAV_ITEMS}>
        <p>Body</p>
      </PortalLayout>
    );

    expect(screen.getByTestId('custom-content')).toBeInTheDocument();
  });

  it('renders the header when provided', () => {
    render(
      <PortalLayout navGroups={NAV_GROUPS} bottomNavItems={BOTTOM_NAV_ITEMS} header={<div>Header content</div>}>
        <p>Body</p>
      </PortalLayout>
    );

    expect(screen.getByText('Header content')).toBeInTheDocument();
  });

  it('renders the bottom nav items', () => {
    render(
      <PortalLayout navGroups={NAV_GROUPS} bottomNavItems={BOTTOM_NAV_ITEMS}>
        <p>Body</p>
      </PortalLayout>
    );

    expect(screen.getByRole('navigation', { name: /bottom navigation/i })).toBeInTheDocument();
  });
});
