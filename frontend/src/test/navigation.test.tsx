import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from '@/App';
import { ApiError, api, OFFLINE_MESSAGE } from '@/services/api';

import * as fixtures from './fixtures';
import { mockApi } from './fixtures';

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>();
  return { ...actual, api: {} };
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </MemoryRouter>,
  );
}

const mainNav = () => screen.getByRole('navigation', { name: 'Main' });

beforeEach(() => {
  Object.assign(api, mockApi());
});

describe('navigation', () => {
  it('shows the landing page with the hero and both calls to action', async () => {
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1, name: /master the art of jutsu/i })).toBeInTheDocument();
    expect(screen.getByText('Your hands are your weapon. Perform the signs. Unleash your power.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /enter the arena/i })).toHaveAttribute('href', '/play');
    expect(screen.getByRole('link', { name: /explore jutsu/i })).toHaveAttribute('href', '/jutsu');
    expect(await screen.findByText('Fireball Jutsu')).toBeInTheDocument();
  });

  it('lists every section in the main menu', () => {
    renderAt('/');
    const links = within(mainNav()).getAllByRole('link').map((link) => link.textContent);
    expect(links).toEqual(['Home', 'Play', 'Jutsu Library', 'Hand Signs', 'Training', 'History', 'Settings']);
  });

  it.each([
    ['Play', /perform the signs/i],
    ['Jutsu Library', /know your arsenal/i],
    ['Hand Signs', /the twelve signs/i],
    ['Training', /teach the recogniser/i],
    ['History', /your record/i],
    ['Settings', /tune your setup/i],
  ])('opens %s from the menu', async (label, heading) => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(within(mainNav()).getByRole('link', { name: label }));
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(within(mainNav()).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
  });

  it('takes the player from the hero button into the arena, camera not yet started', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('link', { name: /enter the arena/i }));
    expect(await screen.findByText('Camera not started')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enter the arena/i })).toBeInTheDocument();
  });

  it('shows a not-found page for unknown routes', () => {
    renderAt('/does-not-exist');
    expect(screen.getByRole('heading', { name: /this path leads nowhere/i })).toBeInTheDocument();
  });
});

describe('when the game server is unreachable', () => {
  beforeEach(() => {
    const offline = () => Promise.reject(new ApiError('network', OFFLINE_MESSAGE));
    Object.assign(api, mockApi(), {
      health: vi.fn(offline),
      signs: vi.fn(offline),
      jutsu: vi.fn(offline),
      history: vi.fn(offline),
      settings: vi.fn(offline),
      trainingStatus: vi.fn(offline),
    });
  });

  it('shows the offline banner and still renders the landing page', async () => {
    renderAt('/');
    expect(await screen.findByText(/the game server is not reachable/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /master the art of jutsu/i })).toBeInTheDocument();
  });

  it('shows an error state with a retry button instead of a blank page', async () => {
    const user = userEvent.setup();
    renderAt('/jutsu');
    expect(await screen.findByRole('heading', { name: /game server offline/i })).toBeInTheDocument();
    expect(screen.getByText(OFFLINE_MESSAGE)).toBeInTheDocument();

    // the server comes back: the same client calls now succeed
    const online = mockApi();
    vi.mocked(api.health).mockImplementation(online.health);
    vi.mocked(api.signs).mockImplementation(online.signs);
    vi.mocked(api.jutsu).mockImplementation(online.jutsu);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Fireball Jutsu' })).toBeInTheDocument();
  });

  it('explains that training is unavailable', async () => {
    renderAt('/training');
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByText(OFFLINE_MESSAGE)).toBeInTheDocument();
  });
});

describe('pages render server data', () => {
  it('shows jutsu as playable when the built-in recogniser covers their signs', async () => {
    renderAt('/jutsu');
    expect((await screen.findAllByText('Unlocked')).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /practice/i })).toHaveAttribute('href', '/play?jutsu=fireball');
  });

  it('shows locked jutsu with the signs the current engine cannot recognise', async () => {
    const locked = { ...fixtures.jutsu, jutsu: [{ ...fixtures.jutsu.jutsu[0], unlocked: false, missing_signs: ['tiger', 'snake', 'ram'] }] };
    vi.mocked(api.jutsu).mockResolvedValue(locked);
    renderAt('/jutsu');
    expect(await screen.findByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('Train Tiger, Snake, Ram to unlock.')).toBeInTheDocument();
  });

  it('opens the arena without a running clock: Start game waits for the camera', async () => {
    renderAt('/play');
    const start = await screen.findByRole('button', { name: 'Start game' });
    expect(start).toBeDisabled();
    expect(screen.getByRole('radio', { name: /normal/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Start the camera')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });

  it('labels built-in signs honestly and never as trained', async () => {
    renderAt('/signs');
    expect(await screen.findByText('3 / 3')).toBeInTheDocument();
    expect(screen.getAllByText('Built-in')).toHaveLength(3);
    expect(screen.queryByText('Recognised')).not.toBeInTheDocument();
    expect(screen.queryByText('Trained model')).not.toBeInTheDocument();
  });

  it('blocks training on an empty dataset and explains that training is optional', async () => {
    renderAt('/training');
    expect(await screen.findByText('Personalise recognition — only if you need to')).toBeInTheDocument();
    expect(screen.getByText(/all twelve signs already work in the arena/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quick calibrate' })).toBeDisabled(); // camera is off
    expect(screen.getByRole('button', { name: 'Train model' })).toBeDisabled();
    expect(screen.getByText(/the dataset is empty/i)).toBeInTheDocument();
  });
});
