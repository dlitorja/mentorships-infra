import type { NextRequest } from "next/server";

export interface MakeRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  url: string;
  body?: object | FormData;
  headers?: Record<string, string>;
}

export function makeRequest({
  method = "GET",
  url,
  body,
  headers,
}: MakeRequestOptions): NextRequest {
  const init: RequestInit = {
    method,
    headers,
  };

  if (body instanceof FormData) {
    init.body = body;
  } else if (body) {
    init.body = JSON.stringify(body);
    init.headers = {
      "Content-Type": "application/json",
      ...headers,
    };
  }

  return new Request(url, init) as NextRequest;
}

export function makeFormDataRequest({
  method = "POST",
  url,
  formData,
  headers,
}: {
  method?: "POST" | "PATCH" | "PUT";
  url: string;
  formData: FormData;
  headers?: Record<string, string>;
}): NextRequest {
  return new Request(url, {
    method,
    body: formData,
    headers,
  }) as NextRequest;
}
