/**
 * FormControls — minimal Input + Select + SearchInput for admin tools.
 * No business logic. Only visual layer wired to design tokens so they
 * adapt to dark / light automatically.
 */
import { forwardRef } from 'react';
import { Search } from 'lucide-react';

export const Input = forwardRef(function Input(
  { className = '', invalid = false, leadingIcon, ...props },
  ref,
) {
  return (
    <div className={`relative ${className}`}>
      {leadingIcon && (
        <span className="absolute inset-y-0 left-3 flex items-center text-token-muted">
          {leadingIcon}
        </span>
      )}
      <input
        ref={ref}
        {...props}
        className={`
          w-full ${leadingIcon ? 'pl-10' : 'px-3'} pr-3 py-2 rounded-lg text-sm
          focus:outline-none transition-ui
        `}
        style={{
          background: 'var(--token-surface)',
          color: 'var(--token-text-primary)',
          border: `1px solid ${invalid ? 'var(--token-danger-border)' : 'var(--token-border)'}`,
          paddingLeft: leadingIcon ? 40 : 12,
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--token-primary)';
          e.currentTarget.style.boxShadow = '0 0 0 3px rgba(11,143,94,0.18)';
          if (props.onFocus) props.onFocus(e);
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = invalid ? 'var(--token-danger-border)' : 'var(--token-border)';
          e.currentTarget.style.boxShadow = 'none';
          if (props.onBlur) props.onBlur(e);
        }}
      />
    </div>
  );
});

export function SearchInput({ value, onChange, placeholder = 'Search…', className = '', testId }) {
  return (
    <Input
      data-testid={testId}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
      leadingIcon={<Search className="w-4 h-4" />}
    />
  );
}

export const Select = forwardRef(function Select(
  { className = '', children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      {...props}
      className={`px-3 py-2 rounded-lg text-sm transition-ui ${className}`}
      style={{
        background: 'var(--token-surface)',
        color: 'var(--token-text-primary)',
        border: '1px solid var(--token-border)',
        appearance: 'auto',
      }}
    >
      {children}
    </select>
  );
});

export function FieldLabel({ children, htmlFor, hint }) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="text-token-kicker block mb-1">{children}</span>
      {hint && <span className="text-small-token block mt-1">{hint}</span>}
    </label>
  );
}

const FormControls = { Input, Select, SearchInput, FieldLabel };
export default FormControls;
