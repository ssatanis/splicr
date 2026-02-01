'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Building2, Loader2 } from 'lucide-react';

export interface InstitutionOption {
  id: string;
  display_name: string;
  hint?: string;
}

interface InstitutionAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  error?: boolean;
}

const DEBOUNCE_MS = 280;
const MIN_QUERY_LENGTH = 1;

export default function InstitutionAutocomplete({
  value,
  onChange,
  required = true,
  placeholder = 'Search for your college or university…',
  disabled = false,
  className = '',
  inputClassName = '',
  error = false,
}: InstitutionAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [options, setOptions] = useState<InstitutionOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const fetchOptions = useCallback(async (q: string) => {
    if (q.length < MIN_QUERY_LENGTH) {
      setOptions([]);
      return;
    }
    setLoading(true);
    setOpen(true);
    try {
      const base = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await fetch(
        `${base}/api/institutions/autocomplete?q=${encodeURIComponent(q)}`
      );
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        setOptions([]);
        return;
      }
      const text = await res.text();
      let data: { results?: InstitutionOption[] };
      try {
        data = text && text.trim() ? JSON.parse(text) : {};
      } catch {
        setOptions([]);
        return;
      }
      const list = Array.isArray(data?.results) ? data.results : [];
      setOptions(list);
      if (list.length > 0) setOpen(true);
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setOptions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      fetchOptions(query.trim());
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, fetchOptions]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (option: InstitutionOption) => {
    onChange(option.display_name);
    setQuery(option.display_name);
    setSelected(true);
    setOpen(false);
    setOptions([]);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    setSelected(false);
    onChange(v);
  };

  const handleFocus = () => {
    if (query.trim().length >= MIN_QUERY_LENGTH) {
      if (options.length > 0) {
        setOpen(true);
      } else {
        fetchOptions(query.trim());
      }
    }
  };

  const showDropdown = open && (options.length > 0 || loading);

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <div className="relative">
        <Building2
          className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-tertiary pointer-events-none"
          strokeWidth={1.5}
        />
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={handleFocus}
          required={required}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          aria-controls="institution-listbox"
          id="institution-autocomplete"
          placeholder={placeholder}
          className={`w-full pl-11 pr-10 py-3 bg-white border rounded-xl font-serif text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all ${error ? 'border-error focus:ring-error/30 focus:border-error' : 'border-border'} ${inputClassName}`}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-tertiary">
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" strokeWidth={1.5} />
          ) : (
            <ChevronDown
              className={`w-5 h-5 transition-transform ${showDropdown ? 'rotate-180' : ''}`}
              strokeWidth={1.5}
            />
          )}
        </span>
      </div>

      {showDropdown && (
        <ul
          id="institution-listbox"
          role="listbox"
          className="absolute z-50 w-full mt-1 py-1 bg-white border border-border rounded-xl shadow-elevated max-h-64 overflow-y-auto focus:outline-none"
          style={{ willChange: 'opacity' }}
        >
          {loading && options.length === 0 ? (
            <li className="px-4 py-3 text-sm text-text-tertiary font-serif">
              Searching…
            </li>
          ) : (
            options.map((option) => (
              <li
                key={option.id}
                role="option"
                aria-selected={value === option.display_name}
                onClick={() => handleSelect(option)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSelect(option);
                  }
                }}
                className="flex flex-col gap-0.5 px-4 py-3 cursor-pointer font-serif text-text-primary hover:bg-background focus:bg-background focus:outline-none border-b border-border-light last:border-b-0"
              >
                <span className="font-medium">{option.display_name}</span>
                {option.hint && (
                  <span className="text-sm text-text-tertiary">{option.hint}</span>
                )}
              </li>
            ))
          )}
        </ul>
      )}

      {required && !value && (
        <p className="mt-1.5 text-xs text-text-tertiary font-serif">
          Select your college or university from the list
        </p>
      )}
    </div>
  );
}
