"use client";

import React, { ReactNode } from "react";
import { FieldApi, useForm } from "@tanstack/react-form";
import { z } from "zod";

interface FormFieldProps<T> {
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
  validator?: { onChange: z.ZodTypeAny };
  children?: (field: FieldApi<T, unknown>) => ReactNode;
}

export function FormField<T>({
  name,
  label,
  placeholder,
  type = "text",
  validator,
  children,
}: FormFieldProps<T>): React.ReactNode {
  return (
    <form.Field name={name} validators={validator}>
      {(field) => (
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
              onChange={(e) => field.handleChange(e.target.value as T)}
              onBlur={field.handleBlur}
              placeholder={placeholder}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          )}
          {field.state.meta.errors.length > 0 && (
            <p className="text-sm text-red-600">{field.state.meta.errors[0]?.message}</p>
          )}
        </div>
      )}
    </form.Field>
  );
}

interface FormProps<T> {
  defaultValues: T;
  validator?: { onChange: z.ZodSchema<T> };
  onSubmit: (values: T) => Promise<void>;
  children: ReactNode | ((form: ReturnType<typeof useForm<T>>) => ReactNode);
}

export function Form<T>({
  defaultValues,
  validator,
  onSubmit,
  children,
}: FormProps<T>): React.ReactNode {
  const form = useForm<T>({
    defaultValues,
    validator,
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      {typeof children === "function" ? children(form) : children}
    </form>
  );
}
