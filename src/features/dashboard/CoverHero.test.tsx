import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CoverHero } from './CoverHero';
import { COVER_PHOTOS } from '@/lib/site';

describe('CoverHero', () => {
  it('greets the person and shows the tagline', () => {
    render(<CoverHero name="Amina" roleLabel="Participant" />);
    expect(screen.getByRole('heading', { name: 'Welcome back, Amina' })).toBeInTheDocument();
    expect(screen.getByText('Participant')).toBeInTheDocument();
    expect(screen.getByText('Your direction.')).toBeInTheDocument();
  });
  it('greets without a name when none is known', () => {
    render(<CoverHero name="" roleLabel="Applicant" />);
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });
  it('lets people pause and resume the photos and pick one', async () => {
    render(<CoverHero name="" roleLabel="Trainer" />);
    const toggle = screen.getByRole('button', { name: /pause photos/i });
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: /play photos/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /show photo/i })).toHaveLength(6);
  });
  it('keeps the photographs behind the greeting, whole (object-contain), never zoomed, cropped or in a separate frame', () => {
    const { container } = render(<CoverHero name="Amina" roleLabel="Participant" />);
    const imgs = Array.from(container.querySelectorAll('header img')) as HTMLImageElement[];
    expect(imgs).toHaveLength(COVER_PHOTOS.length);
    expect(imgs.every((i) => i.className.includes('object-contain') && !/object-cover|kenburns|animate-/.test(i.className))).toBe(true);
    expect(imgs.every((i) => i.className.includes('absolute') && i.className.includes('inset-0'))).toBe(true);
    expect(container.querySelector('[data-photo-frame]')).toBeNull();
    expect(container.querySelector('header')?.className).toContain('dira-welcome');
  });
});
