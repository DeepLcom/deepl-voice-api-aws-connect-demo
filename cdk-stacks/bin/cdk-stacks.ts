#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CdkBackendStack } from "../lib/cdk-backend-stack";
import { CdkFrontendStack } from "../lib/cdk-frontend-stack";

const configParams = require("../config/config.params.json");

const app = new cdk.App();

console.info("Running in stack mode...");
const cdkBackendStack = new CdkBackendStack(app, configParams["CdkBackendStack"], {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  description: "Amazon Connect V2V Sample (uksb-9ktxkll9ec) (version:v1.0)",
});

const cdkFrontendStack = new CdkFrontendStack(app, configParams["CdkFrontendStack"], {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  backendStackOutputs: cdkBackendStack.backendStackOutputs,
  description: "Amazon Connect V2V Sample Frontend",
});
cdkFrontendStack.addDependency(cdkBackendStack);
