"use client";

import React, { ReactNode, useContext } from "react";
import {
  useForm as useTanStackForm,
  FormApi,
  AnyFieldApi,
  ReactFormExtendedApi,
} from "@tanstack/react-form";
import { z } from "zod";

// Type alias for TanStack Form's complex generic signature
// TanStack Form requires 12 type arguments which is verbose
// This pattern is documented in TanStack Form issues as recommended approach
type TypedFormApi<T> = ReactFormExtendedApi<T, any, any, any, any, any, any, any, any>;

const FormContext = React.createContext<TypedFormApi<any> | null>(null);

export function useFormContext<T = unknown>(): TypedFormApi<T> | null {
  return useContext(FormContext) as TypedFormApi<T> | null;
}

interface FormFieldProps {
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
  validators?: { onChange?: z.ZodTypeAny };
  children?: (field: AnyFieldApi) => ReactNode;
}

export function FormField({
  name,
  label,
  placeholder,
  type = "text",
  validators,
  children,
}: FormFieldProps): ReactNode {
  const form = useFormContext();

  if (!form) {
    throw new Error("FormField must be used within a Form component");
  }

  return (
    <form.Field name={name} validators={validators}>
      {(field: AnyFieldApi) => (
        <div className="space-y-2">
          <label htmlFor={field.name} className="text-sm font-medium">
            {label}
          </label>
          {children ? (
            children(field)
          ) : (
            <input
              id={field.name}
              type={type}
              value={typeof field.state.value === "string" ? field.state.value : ""}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                field.handleChange(e.target.value);
              }}
              onBlur={field.handleBlur}
              placeholder={placeholder}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          )}
          {field.state.meta.errors.length > 0 && (
            <p className="text-sm text-red-600">
              {typeof field.state.meta.errors[0] === "string"
                ? field.state.meta.errors[0]
                : field.state.meta.errors[0]?.message ?? String(field.state.meta.errors[0])}
            </p>
          )}
        </div>
      )}
    </form.Field>
  );
}

interface FormProps<T = unknown> {
  defaultValues: T;
  validators?: {
    onChange?: z.ZodSchema<T>;
    onSubmit?: z.ZodSchema<T>;
  };
  onSubmit: (values: T) => Promise<void>;
  children: ReactNode | ((form: TypedFormApi<T>) => ReactNode);
}

export function Form<T>({
  defaultValues,
  validators,
  onSubmit,
  children,
}: FormProps<T>): ReactNode {
  const form = useTanStackForm<T, any, any, any, any, any, any, any, any>({
    defaultValues,
    validators,
    onSubmit: async ({ value }: { value: T }) => {
      await onSubmit(value);
    },
  } as any);

  return (
    <FormContext.Provider value={form as unknown as TypedFormApi<any>}>
      <form
        onSubmit={async (e: React.FormEvent) => {
          e.preventDefault();
          try {
            await form.handleSubmit();
          } catch (error) {
            console.error("Form submission error:", error);
            throw error;
          }
        }}
      >
        {typeof children === "function" ? children(form as unknown as TypedFormApi<T>) : children}
      </form>
    </FormContext.Provider>
  );
}

export function useAppForm<T>(opts: {
  defaultValues: T;
  validators?: {
    onChange?: z.ZodSchema<T>;
    onSubmit?: z.ZodSchema<T>;
  };
  onSubmit?: (values: T) => Promise<void>;
}) {
  return useTanStackForm<T, any, any, any, any, any, any, any, any, any, any, any>(opts as any);
}

interface FormFieldProps {
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
  validators?: { onChange?: z.ZodTypeAny };
  children?: (field: AnyFieldApi) => ReactNode;
}

export function FormField({
  name,
  label,
  placeholder,
  type = "text",
  validators,
  children,
}: FormFieldProps): ReactNode {
  const form = useFormContext();

  if (!form) {
    throw new Error("FormField must be used within a Form component");
  }

  return (
    <form.Field name={name} validators={validators}>
      {(field: AnyFieldApi) => (
        <div className="space-y-2">
          <label htmlFor={field.name} className="text-sm font-medium">
            {label}
          </label>
          {children ? (
            children(field)
          ) : (
            <input
              id={field.name}
              type={type}
              value={typeof field.state.value === "string" ? field.state.value : ""}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                field.handleChange(e.target.value);
              }}
              onBlur={field.handleBlur}
              placeholder={placeholder}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          )}
          {field.state.meta.errors.length > 0 && (
            <p className="text-sm text-red-600">
              {typeof field.state.meta.errors[0] === "string"
                ? field.state.meta.errors[0]
                : field.state.meta.errors[0]?.message ?? String(field.state.meta.errors[0])}
            </p>
          )}
        </div>
      )}
    </form.Field>
  );
}

interface FormProps<T = unknown> {
  defaultValues: T;
  validators?: {
    onChange?: z.ZodSchema<T>;
    onSubmit?: z.ZodSchema<T>;
  };
  onSubmit: (values: T) => Promise<void>;
  children: ReactNode | ((form: TypedFormApi<T>) => ReactNode);
}

export function Form<T>({
  defaultValues,
  validators,
  onSubmit,
  children,
}: FormProps<T>): ReactNode {
  const form = useTanStackForm<T, any, any, any, any, any, any, any, any, any, any, any>({
    defaultValues,
    validators,
    onSubmit: async ({ value }: { value: T }) => {
      await onSubmit(value);
    },
  } as any);

  return (
    <FormContext.Provider value={form as unknown as TypedFormApi<any>}>
      <form
        onSubmit={async (e: React.FormEvent) => {
          e.preventDefault();
          try {
            await form.handleSubmit();
          } catch (error) {
            console.error("Form submission error:", error);
            throw error;
          }
        }}
      >
        {typeof children === "function" ? children(form as unknown as TypedFormApi<T>) : children}
      </form>
    </FormContext.Provider>
  );
}
