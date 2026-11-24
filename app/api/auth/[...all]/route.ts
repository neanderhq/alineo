import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";

export const GET = async (request: Request) => {
  return toNextJsHandler(getAuth()).GET(request);
};

export const POST = async (request: Request) => {
  return toNextJsHandler(getAuth()).POST(request);
};
