import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import RegisterPage from '../page';
import { ParentPortalProvider } from '../../../context/ParentPortalContext';

let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

const STUDENT = { _id: 'student-1', firstName: 'Kid', lastName: 'One' };

const LEVEL_BEGINNER = { _id: 'level-1', name: 'Beginner' };
const LEVEL_ADVANCED = { _id: 'level-2', name: 'Advanced' };

const CLASS_A = { _id: 'class-1', name: 'Beginner Foil', levelId: LEVEL_BEGINNER._id, locationId: 'loc-1', capacity: 10 };
const CLASS_B = { _id: 'class-2', name: 'Advanced Epee', levelId: LEVEL_ADVANCED._id, locationId: 'loc-1', capacity: 10 };

const SCHEDULE_A = { _id: 'sched-1', classId: 'class-1', coachId: 'coach-1', dayOfWeek: 3, startTime: '16:00', endTime: '17:00', students: [] };
const SCHEDULE_B = { _id: 'sched-2', classId: 'class-2', coachId: 'coach-1', dayOfWeek: 4, startTime: '18:00', endTime: '19:00', students: [] };

const PRICE_BEGINNER = { _id: 'price-1', levelId: LEVEL_BEGINNER._id, monthlyFee: 150 };

const SAVED_PAYMENT_METHOD = { _id: 'pm-1', cardBrand: 'visa', cardLast4: '4242', cardExpMonth: 8, cardExpYear: 2030 };

let postPayload: unknown = null;

const server = setupServer(
  http.get('*/students/mine', () => HttpResponse.json({ students: [STUDENT] })),
  http.get('*/registrations/mine', () => HttpResponse.json({ subscriptions: [] })),
  http.get('*/trial-classes/mine', () => HttpResponse.json({ trialClasses: [] })),
  http.get('*/private-class-enrollments/mine', () => HttpResponse.json({ enrollments: [] })),
  http.get('*/group-classes', () => HttpResponse.json({ groupClasses: [CLASS_A, CLASS_B] })),
  http.get('*/group-class-schedules', () => HttpResponse.json({ schedules: [SCHEDULE_A, SCHEDULE_B] })),
  http.get('*/prices', () => HttpResponse.json({ prices: [PRICE_BEGINNER] })),
  http.get('*/levels', () => HttpResponse.json({ levels: [LEVEL_BEGINNER, LEVEL_ADVANCED] })),
  http.get('*/payment-methods/mine', () => HttpResponse.json({ paymentMethod: SAVED_PAYMENT_METHOD })),
  // Default: no discount. Every test gets a real MSW-mocked response for
  // this — without a handler here, MSW's default onUnhandledRequest:'warn'
  // would let the request fall through toward a real (failing) network
  // call in every test that doesn't care about the preview at all.
  http.get('*/registrations/preview', () =>
    HttpResponse.json({
      monthlyFee: 150,
      chargeAmount: 150,
      siblingDiscountApplied: false,
      siblingDiscountAmount: 0,
      siblingDiscountReason: null,
    })
  ),
  http.post('*/registrations', async ({ request }) => {
    postPayload = await request.json();
    return HttpResponse.json(
      { registration: { _id: 'reg-1' }, subscription: { _id: 'sub-1' }, chargeAmount: 150, paymentIntentStatus: 'succeeded' },
      { status: 201 }
    );
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  postPayload = null;
  mockSearchParams = new URLSearchParams();
});
afterAll(() => server.close());

function renderRegisterPage() {
  return render(
    <ParentPortalProvider>
      <RegisterPage />
    </ParentPortalProvider>
  );
}

async function goToReviewStep() {
  fireEvent.click(await screen.findByRole('radio', { name: /kid one/i }));
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));

  fireEvent.click(await screen.findByRole('radio', { name: /beginner/i }));
  const timePill = await screen.findByRole('radio', { name: /wednesday 4:00 pm-5:00 pm/i });
  fireEvent.click(timePill);
  await waitFor(() => expect(timePill).toHaveAttribute('aria-checked', 'true'));

  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
}

describe('RegisterPage wizard', () => {
  it('walks Who -> Level -> Review & Pay -> Done and submits { studentId, scheduleId }', async () => {
    renderRegisterPage();

    await goToReviewStep();

    await screen.findByText(/card on file: visa ending in 4242/i);

    fireEvent.click(screen.getByRole('button', { name: /register & pay/i }));

    await waitFor(() => {
      expect(postPayload).toEqual({ studentId: STUDENT._id, scheduleId: SCHEDULE_A._id });
    });

    expect(await screen.findByText('Registration complete!')).toBeInTheDocument();
    expect(screen.getByText(/\$150\.00/)).toBeInTheDocument();
  });

  it('shows the saved-payment-method guard on the Review step and disables the CTA when no card is on file', async () => {
    server.use(http.get('*/payment-methods/mine', () => HttpResponse.json({ paymentMethod: null })));

    renderRegisterPage();
    await goToReviewStep();

    expect(
      await screen.findByText(/you'll need to add a payment method before registering/i)
    ).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /here/i });
    expect(link).toHaveAttribute('href', '/parent/payment-method');

    expect(screen.getByRole('button', { name: /register & pay/i })).toBeDisabled();
  });

  it('back-navigation from Class to Who preserves the selected child', async () => {
    renderRegisterPage();

    fireEvent.click(await screen.findByRole('radio', { name: /kid one/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await screen.findByRole('radiogroup', { name: /select a level/i });
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));

    const childCard = await screen.findByRole('radio', { name: /kid one/i });
    expect(childCard).toHaveAttribute('aria-checked', 'true');
  });

  it('shows an inline error when the student is already registered for the schedule (409), without crashing', async () => {
    renderRegisterPage();
    await goToReviewStep();
    await screen.findByText(/card on file/i);

    server.use(
      http.post('*/registrations', () =>
        HttpResponse.json({ message: 'This student is already registered for this schedule' }, { status: 409 })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: /register & pay/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('This student is already registered for this schedule');
    });

    // Still on the Review step.
    expect(screen.getByText(/card on file/i)).toBeInTheDocument();
  });

  it('shows a live sibling-discount preview once a child and schedule are both selected', async () => {
    server.use(
      http.get('*/registrations/preview', () =>
        HttpResponse.json({
          monthlyFee: 150,
          chargeAmount: 135,
          siblingDiscountApplied: true,
          siblingDiscountAmount: 15,
          siblingDiscountReason: 'This is the lower-priced plan among your active children, so the 10% sibling discount applies here.',
        })
      )
    );

    renderRegisterPage();

    fireEvent.click(await screen.findByRole('radio', { name: /kid one/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    fireEvent.click(await screen.findByRole('radio', { name: /beginner/i }));
    fireEvent.click(await screen.findByRole('radio', { name: /wednesday 4:00 pm-5:00 pm/i }));

    expect(await screen.findByText(/10% sibling discount applied — \$135\.00\/month/)).toBeInTheDocument();
    expect(screen.getByText('Sibling Discount')).toBeInTheDocument();
    expect(screen.getByText('-$15.00')).toBeInTheDocument();
    expect(screen.getByText("You'll Pay")).toBeInTheDocument();
    expect(screen.getByText('$135.00')).toBeInTheDocument();
  });

  it('shows no discount lines when the preview reports none', async () => {
    renderRegisterPage();
    await goToReviewStep();

    expect(screen.queryByText('Sibling Discount')).not.toBeInTheDocument();
    expect(screen.queryByText("You'll Pay")).not.toBeInTheDocument();
  });

  it('still registers successfully when the discount-preview endpoint fails — the preview is best-effort only', async () => {
    server.use(http.get('*/registrations/preview', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));

    renderRegisterPage();
    await goToReviewStep();
    await screen.findByText(/card on file: visa ending in 4242/i);

    fireEvent.click(screen.getByRole('button', { name: /register & pay/i }));

    await waitFor(() => {
      expect(postPayload).toEqual({ studentId: STUDENT._id, scheduleId: SCHEDULE_A._id });
    });
    expect(await screen.findByText('Registration complete!')).toBeInTheDocument();
  });

  it('shows the real applied sibling discount and the backend-supplied reason on the confirmation screen, from the actual charge response', async () => {
    server.use(
      http.post('*/registrations', async ({ request }) => {
        postPayload = await request.json();
        return HttpResponse.json(
          {
            registration: { _id: 'reg-1' },
            subscription: { _id: 'sub-1' },
            chargeAmount: 135,
            paymentIntentStatus: 'succeeded',
            siblingDiscountApplied: true,
            siblingDiscountAmount: 15,
            siblingDiscountReason: 'This is the lower-priced plan among your active children, so the 10% sibling discount applies here.',
          },
          { status: 201 }
        );
      })
    );

    renderRegisterPage();
    await goToReviewStep();
    await screen.findByText(/card on file/i);

    fireEvent.click(screen.getByRole('button', { name: /register & pay/i }));

    expect(await screen.findByText('Registration complete!')).toBeInTheDocument();
    expect(screen.getByText(/\$135\.00/)).toBeInTheDocument();
    expect(screen.getByText('Sibling Discount')).toBeInTheDocument();
    expect(screen.getByText('-$15.00')).toBeInTheDocument();
    expect(
      screen.getByText('This is the lower-priced plan among your active children, so the 10% sibling discount applies here.')
    ).toBeInTheDocument();
  });
});
