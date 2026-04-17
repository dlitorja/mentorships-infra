import { defineApp } from "convex/server";
import authConfig from "./convex/auth.config";

const convex = defineApp({
  authConfig,
});

export default convex;
