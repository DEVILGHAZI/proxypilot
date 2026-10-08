export type ApiErrorBody = {
  code: string;
  message: string;
};

export type ApiFailure = {
  success: false;
  requestId: string;
  error: ApiErrorBody;
};

export type ApiSuccess<T> = {
  success: true;
  requestId: string;
  data: T;
};

export function apiFailure(requestId: string, code: string, message: string): ApiFailure {
  return {
    success: false,
    requestId,
    error: { code, message },
  };
}

export function apiSuccess<T>(requestId: string, data: T): ApiSuccess<T> {
  return {
    success: true,
    requestId,
    data,
  };
}
