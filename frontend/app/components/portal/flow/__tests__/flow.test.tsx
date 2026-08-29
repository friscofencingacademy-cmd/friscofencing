import { render, screen, fireEvent, within } from '@testing-library/react';

import FlowMain, { FlowStepper } from '../FlowMain';
import OrderSummary from '../OrderSummary';
import ChildPickerCards from '../ChildPickerCards';
import FlowConfirmation from '../FlowConfirmation';
import PillRow from '../PillRow';

describe('FlowStepper', () => {
  it('marks steps before `current` as done and the current step as active', () => {
    render(<FlowStepper steps={['Who', 'Class', 'Done']} current={1} />);

    const stepItems = screen.getAllByRole('listitem');
    expect(stepItems).toHaveLength(3);

    // Step 0 ("Who") is done -> shows a checkmark, not "1".
    expect(within(stepItems[0]).getByText('✓')).toBeInTheDocument();
    // Step 1 ("Class") is active.
    expect(screen.getByText('Class')).toBeInTheDocument();
    // Step 2 ("Done") is upcoming -> shows its number.
    expect(within(stepItems[2]).getByText('3')).toBeInTheDocument();
  });
});

describe('FlowMain', () => {
  it('renders the breadcrumb, title, and children in a two-column layout with a summary rail', () => {
    render(
      <FlowMain
        crumbs={[{ label: 'Home', href: '/parent/dashboard' }, { label: 'Book a Trial' }]}
        title="Book a Trial"
        current={0}
        summary={<div data-testid="summary">Summary content</div>}
      >
        <div>Main content</div>
      </FlowMain>
    );

    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/parent/dashboard');
    expect(screen.getByRole('heading', { name: 'Book a Trial' })).toBeInTheDocument();
    expect(screen.getByText('Main content')).toBeInTheDocument();
    expect(screen.getByTestId('summary')).toBeInTheDocument();
  });

  it('renders single-column (no summary rail) when singleColumn is set, even if summary is passed', () => {
    render(
      <FlowMain crumbs={[{ label: 'Home' }]} title="Done" current={0} singleColumn summary={<div data-testid="summary" />}>
        <div>Confirmation</div>
      </FlowMain>
    );

    expect(screen.queryByTestId('summary')).not.toBeInTheDocument();
  });
});

describe('OrderSummary', () => {
  it('renders lines and calls onCta when the CTA is clicked', () => {
    const onCta = jest.fn();

    render(
      <OrderSummary
        lines={[{ label: 'Child', value: 'Kid One' }]}
        cta="Continue"
        onCta={onCta}
      />
    );

    expect(screen.getByText('Child')).toBeInTheDocument();
    expect(screen.getByText('Kid One')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onCta).toHaveBeenCalledTimes(1);
  });

  it('disables the CTA when ctaDisabled is true', () => {
    render(<OrderSummary lines={[]} cta="Continue" ctaDisabled onCta={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('shows a loading state on the CTA when ctaLoading is true', () => {
    render(<OrderSummary lines={[]} cta="Booking..." ctaLoading onCta={jest.fn()} />);

    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders no CTA button when cta is omitted', () => {
    render(<OrderSummary lines={[{ label: 'X', value: 'Y' }]} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // Family Scorecard checkout quote panel (docs/plans/wordpress-ui-
  // alignment-plan.md, Phase 3) — `kind` is optional and backward-
  // compatible (the tests above never pass it), so this covers only the
  // new variants' own rendering.
  it('renders a "note" line as its own paragraph, not a bordered summaryRow', () => {
    render(
      <OrderSummary
        lines={[
          { label: 'Sibling Discount', value: '-$15.00', kind: 'discount' },
          { label: 'Why', value: 'The lower-priced plan among your children.', kind: 'note' },
        ]}
      />
    );

    expect(screen.getByText('-$15.00')).toBeInTheDocument();
    expect(screen.getByText('The lower-priced plan among your children.')).toBeInTheDocument();
    // A note line renders only its value (no separate "Why" label node) —
    // it's a caption under the row above it, not a labeled row of its own.
    expect(screen.queryByText('Why')).not.toBeInTheDocument();
  });

  it('renders a "total" line and an always-visible "Live Quote" overline', () => {
    render(<OrderSummary lines={[{ label: 'Due at enrollment', value: '$175.00', kind: 'total' }]} />);

    expect(screen.getByText('Live Quote')).toBeInTheDocument();
    expect(screen.getByText('Due at enrollment')).toBeInTheDocument();
    expect(screen.getByText('$175.00')).toBeInTheDocument();
  });
});

describe('ChildPickerCards', () => {
  const STUDENTS = [
    { _id: 's1', firstName: 'Kid', lastName: 'One' },
    { _id: 's2', firstName: 'Kid', lastName: 'Two' },
  ];

  it('renders one radio card per student and calls onSelect', () => {
    const onSelect = jest.fn();

    render(<ChildPickerCards students={STUDENTS} selectedId="" onSelect={onSelect} />);

    expect(screen.getByText('Kid One')).toBeInTheDocument();
    expect(screen.getByText('Kid Two')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /kid one/i }));
    expect(onSelect).toHaveBeenCalledWith('s1');
  });

  it('marks the selected student as checked', () => {
    render(<ChildPickerCards students={STUDENTS} selectedId="s2" onSelect={jest.fn()} />);

    expect(screen.getByRole('radio', { name: /kid two/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /kid one/i })).toHaveAttribute('aria-checked', 'false');
  });
});

describe('PillRow', () => {
  const SESSIONS = [
    { id: 'sess-1', label: 'Wed, Sep 3', sub: '4:00 PM–5:00 PM' },
    { id: 'sess-2', label: 'Fri, Sep 5', sub: '6:00 PM–7:00 PM' },
  ];

  it('renders one pill per item with its label and sub, and calls onSelect', () => {
    const onSelect = jest.fn();

    render(
      <PillRow
        items={SESSIONS}
        selectedKey={null}
        onSelect={onSelect}
        getKey={(s) => s.id}
        getLabel={(s) => s.label}
        getSub={(s) => s.sub}
        ariaLabel="Select a session"
      />
    );

    expect(screen.getByText('Wed, Sep 3')).toBeInTheDocument();
    expect(screen.getByText('4:00 PM–5:00 PM')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /wed, sep 3/i }));
    expect(onSelect).toHaveBeenCalledWith('sess-1');
  });

  it('marks the selected pill as checked, and others as not checked', () => {
    render(
      <PillRow
        items={SESSIONS}
        selectedKey="sess-2"
        onSelect={jest.fn()}
        getKey={(s) => s.id}
        getLabel={(s) => s.label}
        ariaLabel="Select a session"
      />
    );

    expect(screen.getByRole('radio', { name: /fri, sep 5/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /wed, sep 3/i })).toHaveAttribute('aria-checked', 'false');
  });

  it('renders the radiogroup with the given accessible label, and omits getSub when not passed', () => {
    render(
      <PillRow
        items={SESSIONS}
        selectedKey={null}
        onSelect={jest.fn()}
        getKey={(s) => s.id}
        getLabel={(s) => s.label}
        ariaLabel="Select a session"
      />
    );

    expect(screen.getByRole('radiogroup', { name: 'Select a session' })).toBeInTheDocument();
    expect(screen.queryByText('4:00 PM–5:00 PM')).not.toBeInTheDocument();
  });
});

describe('FlowConfirmation', () => {
  it('renders the title, subtitle, lines, and links', () => {
    render(
      <FlowConfirmation
        title="Trial class booked!"
        subtitle="We look forward to seeing you."
        lines={[{ label: 'Child', value: 'Kid One' }]}
        links={<a href="/parent/dashboard">Back to Dashboard</a>}
      />
    );

    expect(screen.getByText('Trial class booked!')).toBeInTheDocument();
    expect(screen.getByText('We look forward to seeing you.')).toBeInTheDocument();
    expect(screen.getByText('Child')).toBeInTheDocument();
    expect(screen.getByText('Kid One')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toBeInTheDocument();
  });
});
