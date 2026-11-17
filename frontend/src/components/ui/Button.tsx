import { LoaderCircle, type LucideIcon } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface CommonProps {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  children?: ReactNode;
  className?: string;
}

const BASE =
  'group relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-display font-semibold uppercase tracking-[0.14em] transition duration-200 disabled:pointer-events-none disabled:opacity-45';

const VARIANTS: Record<Variant, string> = {
  primary:
    'clip-corners bg-gradient-to-r from-accent to-[rgb(var(--accent-deep))] text-white shadow-[0_10px_30px_-12px_rgb(var(--accent)/0.9)] hover:brightness-125 active:brightness-95',
  secondary:
    'rounded-lg border border-white/15 bg-white/[0.04] text-fg hover:border-accent/60 hover:bg-accent/10 active:bg-accent/20',
  ghost: 'rounded-lg text-fg-muted hover:bg-white/[0.06] hover:text-fg',
  danger: 'rounded-lg border border-ember/40 bg-ember/10 text-[#ff9aa6] hover:bg-ember/20 hover:text-white',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[11px]',
  md: 'h-10 px-4 text-xs',
  lg: 'h-12 px-7 text-sm',
};

const ICON_SIZES: Record<Size, string> = { sm: 'h-3.5 w-3.5', md: 'h-4 w-4', lg: 'h-[18px] w-[18px]' };

function classes(variant: Variant, size: Size, className?: string): string {
  return [BASE, VARIANTS[variant], SIZES[size], className].filter(Boolean).join(' ');
}

function Content({ icon: Icon, iconRight: IconRight, loading, size = 'md', children }: CommonProps) {
  const iconClass = ICON_SIZES[size];
  return (
    <>
      {loading ? <LoaderCircle className={`${iconClass} animate-spin`} aria-hidden /> : Icon && <Icon className={iconClass} aria-hidden />}
      {children}
      {IconRight && <IconRight className={`${iconClass} transition-transform group-hover:translate-x-0.5`} aria-hidden />}
    </>
  );
}

type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconRight, loading, children, className, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={classes(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <Content icon={icon} iconRight={iconRight} loading={loading} size={size}>
        {children}
      </Content>
    </button>
  );
});

/** A router link styled as a button. */
export function ButtonLink({
  to,
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  children,
  className,
}: CommonProps & { to: string }) {
  return (
    <Link to={to} className={classes(variant, size, className)}>
      <Content icon={icon} iconRight={iconRight} size={size}>
        {children}
      </Content>
    </Link>
  );
}
