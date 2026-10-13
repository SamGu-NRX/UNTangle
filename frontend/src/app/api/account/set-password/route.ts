import { auth } from "@/lib/auth";
import { setPasswordHandler } from "@/lib/account-password";

export const POST = setPasswordHandler(auth);
