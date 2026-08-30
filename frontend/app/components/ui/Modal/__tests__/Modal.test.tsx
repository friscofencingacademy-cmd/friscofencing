import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Modal from '../Modal';

// Renders Modal alongside a real trigger button so focus-capture/restore can
// be asserted against something real, not a mock — matching this repo's
// existing convention of rendering the real provider tree rather than a
// hand-rolled stand-in (docs/TESTING_STRATEGY.md's Isolation rules).
function Harness({
  hideCloseButton,
  disableClose,
}: {
  hideCloseButton?: boolean;
  disableClose?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open Modal
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Test Modal"
        hideCloseButton={hideCloseButton}
        disableClose={disableClose}
        footer={<button type="button">Save</button>}
      >
        <label htmlFor="harness-field">Some Field</label>
        <input id="harness-field" />
      </Modal>
    </div>
  );
}

describe('Modal', () => {
  it('renders nothing when open is false', () => {
    render(<Modal open={false} onClose={jest.fn()} title="Hidden Modal">Body</Modal>);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the title, body, and footer when open', () => {
    render(
      <Modal open onClose={jest.fn()} title="My Dialog" footer={<button type="button">Confirm</button>}>
        Body content
      </Modal>
    );

    const dialog = screen.getByRole('dialog', { name: 'My Dialog' });
    expect(dialog).toHaveTextContent('Body content');
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });

  // The actual owner-reported bug (docs/plans/shared-modal-component-plan.md)
  // — proven once here, at the component's own source of truth, rather than
  // re-proven in every one of the 13 pages that render through it.
  describe('backdrop click regression — clicking outside no longer closes the dialog (owner-reported 2026-08-29)', () => {
    it('does not call onClose when the overlay backdrop itself is clicked', async () => {
      const user = userEvent.setup();
      const onClose = jest.fn();
      render(
        <Modal open onClose={onClose} title="My Dialog">
          Body
        </Modal>
      );

      // The overlay is the dialog's own parent — clicking it directly (not a
      // descendant) is exactly the "misclick outside the box" the owner
      // reported. getByRole('dialog').parentElement IS the overlay div,
      // since Modal renders <overlay><dialog>...</dialog></overlay> with no
      // wrapper in between.
      const overlay = screen.getByRole('dialog').parentElement as HTMLElement;
      await user.click(overlay);

      expect(onClose).not.toHaveBeenCalled();
    });

    it('does not call onClose when clicking inside the dialog body', async () => {
      const user = userEvent.setup();
      const onClose = jest.fn();
      render(
        <Modal open onClose={onClose} title="My Dialog">
          <p>Some body text</p>
        </Modal>
      );

      await user.click(screen.getByText('Some body text'));

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it('calls onClose when the X button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(
      <Modal open onClose={onClose} title="My Dialog">
        Body
      </Modal>
    );

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape is pressed', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(
      <Modal open onClose={onClose} title="My Dialog">
        Body
      </Modal>
    );

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('disableClose', () => {
    it('disables the X button and Escape becomes a no-op', async () => {
      const user = userEvent.setup();
      const onClose = jest.fn();
      render(
        <Modal open onClose={onClose} title="My Dialog" disableClose>
          Body
        </Modal>
      );

      expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();

      await user.keyboard('{Escape}');

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('hideCloseButton', () => {
    it('renders no Close button at all, but Escape still works', async () => {
      const user = userEvent.setup();
      const onClose = jest.fn();
      render(
        <Modal open onClose={onClose} title="Delete Item" hideCloseButton>
          Are you sure?
        </Modal>
      );

      expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();

      await user.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('accessible name', () => {
    it('falls back to title when ariaLabel is omitted', () => {
      render(
        <Modal open onClose={jest.fn()} title="Add Price">
          Body
        </Modal>
      );

      expect(screen.getByRole('dialog', { name: 'Add Price' })).toBeInTheDocument();
    });

    it('uses ariaLabel when provided, even though it differs from the visible title', () => {
      render(
        <Modal open onClose={jest.fn()} title="Add Price" ariaLabel="Custom Accessible Name">
          Body
        </Modal>
      );

      expect(screen.getByRole('dialog', { name: 'Custom Accessible Name' })).toBeInTheDocument();
      expect(screen.getByText('Add Price')).toBeInTheDocument();
    });
  });

  describe('size', () => {
    it('applies the sm dialog class when size="sm"', () => {
      render(
        <Modal open onClose={jest.fn()} title="Confirm" size="sm">
          Body
        </Modal>
      );

      // CSS Modules class identity isn't asserted directly (docs/TESTING_
      // STRATEGY.md's "What NOT to test") — the sm-vs-md distinction is
      // asserted structurally instead, via the dialog's own className
      // string containing both the base and size-specific hashed classes,
      // which is the one place this repo's convention allows a className
      // check (there's no rendered-text/role difference to assert on).
      const dialog = screen.getByRole('dialog');
      expect(dialog.className.split(' ')).toHaveLength(2);
    });

    it('applies only the base dialog class by default (no size given)', () => {
      render(
        <Modal open onClose={jest.fn()} title="Confirm">
          Body
        </Modal>
      );

      const dialog = screen.getByRole('dialog');
      expect(dialog.className.split(' ')).toHaveLength(1);
    });
  });

  describe('focus management', () => {
    it('moves focus into the dialog on open, and restores it to the trigger on close', async () => {
      const user = userEvent.setup();
      render(<Harness />);

      const openButton = screen.getByRole('button', { name: 'Open Modal' });
      openButton.focus();
      expect(openButton).toHaveFocus();

      await user.click(openButton);

      const dialog = await screen.findByRole('dialog');
      await waitFor(() => expect(dialog).toHaveFocus());

      await user.keyboard('{Escape}');

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(openButton).toHaveFocus();
    });
  });
});
