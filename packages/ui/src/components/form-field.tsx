"use client";

import React, { ReactNode, createContext, useContext } from "react";
import { FieldApi, useForm, FormApi } from "@tanstack/react-form";
import { z } from "zod";

const FormContext = createContext<FormApi<any> | null>(null);

function useFormContext<T>(): FormApi<T> {
  const context = useContext(FormContext);
  if (!context) {
    throw new Error("FormField must be used within a Form component");
  }
  return context as FormApi<T>;
}

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
}: FormFieldProps<T>): ReactNode {
  const form = useFormContext<T>();

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
              onChange={(e) => {
                const val = e.target.value;
                field.handleChange(val as T);
              }}
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
  children: ReactNode | ((form: FormApi<T>) => ReactNode);
}

export function Form<T>({
  defaultValues,
  validator,
  onSubmit,
  children,
}: FormProps<T>): ReactNode {
  const form = useForm<T>({
    defaultValues,
    validator,
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });

  return (
    <FormContext.Provider value={form}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        {typeof children === "function" ? children(form) : children}
      </form>
    </FormContext.Provider>
  );
}
