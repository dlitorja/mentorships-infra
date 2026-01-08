"use client";

import React, { ReactNode, createContext, useContext } from "react";
import { useForm as useTanStackForm, FormApi } from "@tanstack/react-form";
import { z } from "zod";

/**
 * FormContext uses `any` due to TanStack Form v1.27's complex generic types
 * (FormApi requires 11-12 type arguments). TODO: Replace with strict interface
 * once TanStack Form exposes stable, simpler types. useFormContext<T>() provides
 * a generic consumer API for typed access.
 */
const FormContext = createContext<any>(null);

function useFormContext<T = any>(): T {
  const context = useContext(FormContext);
  if (!context) {
    throw new Error("FormField must be used within a Form component");
  }
  return context as T;
}

interface FormFieldProps {
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
  validators?: { onChange?: z.ZodTypeAny };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // expected runtime field shape varies; typed externally by consumers
  children?: (field: any) => ReactNode;
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

  return (
    <form.Field name={name} validators={validators}>
      {(field: any) => (
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
              onChange={(e) => {
                const val = e.target.value;
                field.handleChange(val);
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

interface FormProps {
  defaultValues: any;
  validators?: {
    onChange?: z.ZodSchema<any>;
    onSubmit?: z.ZodSchema<any>;
  };
  onSubmit: (values: any) => Promise<void>;
  children: ReactNode | ((form: any) => ReactNode);
}

export function Form({
  defaultValues,
  validators,
  onSubmit,
  children,
}: FormProps): ReactNode {
  const form = (useTanStackForm as any)({
    defaultValues,
    validators,
    onSubmit: async ({ value }: { value: any }) => {
      await onSubmit(value);
    },
  });

  return (
    <FormContext.Provider value={form}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await form.handleSubmit();
          } catch (error) {
            console.error("Form submission error:", error);
            throw error;
          }
        }}
      >
        {typeof children === "function" ? children(form) : children}
      </form>
    </FormContext.Provider>
  );
}
