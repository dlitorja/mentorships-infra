"use client";

import React, { ReactNode, createContext, useContext } from "react";
import { useForm as useTanStackForm, FormApi } from "@tanstack/react-form";
import { z } from "zod";

const FormContext = createContext<any>(null);

function useFormContext<T>(): any {
  const context = useContext(FormContext);
  if (!context) {
    throw new Error("FormField must be used within a Form component");
  }
  return context;
}

interface FormFieldProps {
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
  validators?: { onChange?: z.ZodTypeAny };
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
            <p className="text-sm text-red-600">{field.state.meta.errors[0]?.message}</p>
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
