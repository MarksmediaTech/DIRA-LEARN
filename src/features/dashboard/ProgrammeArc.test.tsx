import { render, screen } from '@testing-library/react';
import { ProgrammeArc, weekState, type ArcSession } from './ProgrammeArc';

const s = (sessionNo: number, weekNo: number, state: ArcSession['state']): ArcSession => ({ sessionNo, weekNo, title: `S${sessionNo}`, state });

describe('ProgrammeArc', () => {
  it('derives week state', () => {
    expect(weekState([])).toBe('upcoming');
    expect(weekState([s(1, 1, 'done'), s(2, 1, 'done')])).toBe('done');
    expect(weekState([s(1, 1, 'done'), s(2, 1, 'next')])).toBe('next');
  });
  it('renders four weeks and prompts for a track when later weeks are empty', () => {
    render(<ProgrammeArc sessions={[s(1, 1, 'done'), s(2, 1, 'next')]} />);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(4);
    expect(screen.getAllByText(/choose a track/i)).toHaveLength(3);
  });
});
