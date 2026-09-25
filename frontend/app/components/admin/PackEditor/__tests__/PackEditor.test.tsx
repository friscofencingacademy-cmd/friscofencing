import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import PackEditor from '../PackEditor';
import { packRowsFromPacks, type PackEditorRow, type PackRowStatus } from '../../../../../lib/hooks/useContractPreview';

// PackEditor is presentational (docs/plans/coach-pack-pricing-plan.md §8 V7):
// it renders rows and whatever status it is given; the preview behind the
// status is covered by lib/hooks/__tests__/useContractPreview.test.tsx.

function Harness({
  initial,
  statusFor = () => ({ text: 'status text', tone: 'hint' }),
}: {
  initial: PackEditorRow[];
  statusFor?: (row: PackEditorRow) => PackRowStatus;
}) {
  const [rows, setRows] = useState(initial);
  return (
    <>
      <PackEditor rows={rows} onChange={setRows} statusFor={statusFor} defaultMinutes="60" />
      <output data-testid="rows">{JSON.stringify(rows.map(({ key, ...row }) => row))}</output>
    </>
  );
}

describe('PackEditor', () => {
  it('renders each saved pack as editable fields with its status line', () => {
    render(
      <Harness initial={packRowsFromPacks([{ _id: 'p1', sessionDurationMinutes: 30, quantity: 10, price: 300 }])} />
    );

    expect(screen.getByLabelText(/pack 1 lesson length/i)).toHaveValue(30);
    expect(screen.getByLabelText(/pack 1 sessions/i)).toHaveValue(10);
    expect(screen.getByLabelText(/pack 1 price/i)).toHaveValue(300);
    expect(screen.getByText('status text')).toBeInTheDocument();
  });

  it('adds a row with the default lesson length, edits it, and removes it', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[]} />);

    await user.click(screen.getByRole('button', { name: /add pack/i }));
    expect(screen.getByLabelText(/pack 1 lesson length/i)).toHaveValue(60);

    await user.type(screen.getByLabelText(/pack 1 sessions/i), '5');
    await user.type(screen.getByLabelText(/pack 1 price/i), '280');
    expect(screen.getByTestId('rows')).toHaveTextContent(
      JSON.stringify([{ sessionDurationMinutes: '60', quantity: '5', price: '280' }])
    );

    await user.click(screen.getByRole('button', { name: /remove pack 1/i }));
    expect(screen.queryByLabelText(/pack 1 price/i)).not.toBeInTheDocument();
  });

  it('renders whatever status it is given, including a refusal message', () => {
    render(
      <Harness
        initial={packRowsFromPacks([{ _id: 'p1', sessionDurationMinutes: 30, quantity: 10, price: 325 }])}
        statusFor={() => ({ text: '10 × 30 min: price must be between $162.50 and $324.99', tone: 'error' })}
      />
    );

    expect(screen.getByText('10 × 30 min: price must be between $162.50 and $324.99')).toBeInTheDocument();
  });
});
