import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'accent' | 'quiet';
const styles: Record<Variant, string> = {
  primary: 'bg-purple-600 text-white hover:bg-purple-700',
  accent: 'bg-orange-500 text-ink hover:bg-orange-600 hover:text-white',
  quiet: 'bg-purple-50 text-purple-700 hover:bg-purple-100',
};

export function Button({ variant = 'primary', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...rest} className={`rounded-control px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`} />;
}
