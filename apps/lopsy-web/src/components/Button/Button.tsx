import styles from './Button.module.css';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = 'secondary', className, children, ...rest }: ButtonProps) {
  const cls = [
    styles.button,
    styles[variant],
    className,
  ].filter(Boolean).join(' ');

  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}
