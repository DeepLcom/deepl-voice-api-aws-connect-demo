# Amazon Connect Voice to Voice (V2V) Translation Setup Guide

## Table of Contents

- [Solution components](#solution-components)
- [Solution prerequisites](#solution-prerequisites)
- [Solution setup](#solution-setup)
- [Test Webapp locally](#test-webapp-locally)
- [Clean up](#clean-up)
- [Demo Webapp key components](#demo-webapp-key-components)

## Solution components

On a high-level, the solution consists of the following components, each contained in these folders:

- **webapp** - Demo Web Application
- **cdk-stacks** - AWS CDK stacks:
  - `cdk-backend-stack` with all the backend resources needed for the solution (Amazon Cognito, etc)
  - `cdk-front-end-stack` with front-end resources for hosting the webapp (Amazon S3, Amazon CloudFront distribution)
- **lambda-functions** - DeepL API proxy AWS Lambda functions (`request-session`, `get-languages`). The webapp cannot call the DeepL API directly from the browser (CORS), so these functions proxy the requests. **They are _not_ deployed by CDK** and must be deployed manually — see [Step 5a](#5a-deploy-the-deepl-proxy-lambda-functions) below.

## Solution prerequisites

- AWS Account
- [AWS IAM user](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_users_create.html) with Administrator permissions
- Amazon Connect instance
- **DeepL API Keys**: You will need DeepL API keys for both environments:
  - **Production API Key** (`DEEPL_API_KEY`) - for production use
  - **Development API Key** (`DEEPL_DEV_API_KEY`) - for development/testing
  - These must be configured as Lambda environment variables (see step 5a below)
- [Node](https://nodejs.org/) (v20) and [NPM](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) (v10) installed and configured on your computer
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html) (v2) installed and configured on your computer
- [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html) (v2) installed and configured on your computer

## Solution setup

The below instructions show how to deploy the solution using AWS CDK CLI. If you are using a Windows device please use the [Git BASH](https://gitforwindows.org/) terminal and use alternative commands where highlighted.

These instructions assume you have completed all the prerequisites, and you have an existing Amazon Connect instance.

1. Clone the solution to your computer (using `git clone`)

2. Check AWS CLI

   - AWS CDK will use AWS CLI local credentials and region
   - check your AWS CLI configuration by running an AWS CLI command (e.g. `aws s3 ls`)
   - you can also use profiles (i.e. `export AWS_PROFILE=<<yourProfile>>`)
   - you can confirm the configured region with  
     `aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]'`

3. Install NPM packages

   - Open your Terminal and navigate to `connect-v2v-translation-with-cx-options/cdk-stacks`
   - Run `npm run install:all`
   - This script goes through all packages of the solution and installs necessary modules (webapp, cdk-stacks)

4. Configure CDK stacks

   - In your terminal, navigate to `connect-v2v-translation-with-cx-options/cdk-stacks`
   - To see the full instructions for the configuration script, run  
     `npm run configure:help`
   - For the purpose of this guide, start the configuration script in interactive mode which will guide you through each input one at a time.
     (Note, it is possible to configure it via single command, by directly providing parameters, as described in the script help instructions)

     `npm run configure`

   - When prompted, provide the following parameters:
     - `cognito-domain-prefix`: Amazon Cognito hosted UI domain prefix, where users will be redirected during the login process. The domain prefix has to be unique, between 1 and 63 characters long, contains no special characters, and no keywords: `aws`, `amazon`, or `cognito` (RegEx pattern: `^[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?$`). You could put your Amazon Connect Instance Alias to it, for example: connect-v2v-instance-alias
     - `cognito-callback-urls`: Please provide a callback URL for the Amazon Cognito authorization server to call after users are authenticated. For now, set it as `https://localhost:5173`, we will come back to it once our front-end is deployed.
     - `cognito-logout-urls`: Please provide a logout URL where user is to be redirected after logging out. For now, set it as `https://localhost:5173`, we will come back to it once our front-end is deployed.
     - `connect-instance-url`: Amazon Connect instance URL that solution will use. For example: `https://connect-instance-alias.my.connect.aws` (or `https://connect-instance-alias.awsapps.com`)
     - `connect-instance-region`: Amazon Connect instance Region that solution will use. For example: us-east-1
     - `transcribe-region`: Amazon Transcribe Region that solution will use. For example: us-east-1
     - `translate-region`: Amazon Translate Region that solution will use. For example: us-east-1
     - `translate-proxy-enabled`: When enabled, webapp requests to Amazon Translate are proxied through Amazon Cloudfront (recommended to avoid CORS)
     - `polly-region`: Amazon Polly Region that solution will use. For example: us-east-1
     - `polly-proxy-enabled`: When enabled, webapp requests to Amazon Polly are proxied through Amazon Cloudfront (recommended to avoid CORS)

5. Deploy CDK stacks

   - In your terminal, navigate to navigate to `connect-v2v-translation-with-cx-options/cdk-stacks`
   - Run the script: `npm run build:webapp` (remember to complete this step whenever you want to deploy new front end changes)
     - **On Windows devices use `npm run build:webapp:gitbash`**.
   - This script builds frontend applications (webapp)
   - If you have started with a new environment, please bootstrap CDK: `cdk bootstrap`
   - Run the script: `npm run cdk:deploy`
     - **On Windows devices use `npm run cdk:deploy:gitbash`**.
   - This script deploys CDK stacks
   - Wait for all resources to be provisioned before continuing to the next step
   - AWS CDK output will be provided in your Terminal. You should see the Amazon Cognito User Pool Id as `userPoolId` from your Backend stack,
     and Amazon CloudFront Distribution URL as `webAppURL` from your Frontend stack.
     **Save these values as you will be using them in the next few steps.**

### 5a. Deploy the DeepL proxy Lambda functions

> **Important:** These two Lambda functions are **not** part of the CDK stack, so `npm run cdk:deploy` does **not** create them. You must deploy them manually using the steps below (one-time setup). Without them the webapp has no way to reach the DeepL API and translation will not work.

The webapp talks to DeepL through two Lambda functions, each exposed via a public [Lambda Function URL](https://docs.aws.amazon.com/lambda/latest/dg/lambda-urls.html):

- `deepl-v2v-request-session` - starts a DeepL Voice2Voice realtime session
- `deepl-v2v-get-languages` - fetches the list of supported languages

The source for both lives under [`lambda-functions/`](lambda-functions/), together with the IAM trust policy and CORS configuration you will reference below.

You can create these resources from the [AWS Lambda Console](https://console.aws.amazon.com/lambda) (create function → Node.js 20.x runtime → paste `index.mjs` → enable a Function URL with auth type `NONE` and CORS `*` → add the environment variables), or use the AWS CLI walkthrough below.

1. Open your terminal and navigate to the `lambda-functions` folder:

   ```bash
   cd connect-v2v-translation-with-cx-options/lambda-functions
   ```

2. Set the region you are deploying to (use the same region as the rest of the solution):

   ```bash
   export REGION=us-east-1
   ```

3. Build a fresh deployment package for each function from its `index.mjs` source (do **not** rely on the pre-built `.zip` files in the repo — they can be out of date):

   ```bash
   (cd request-session && zip -qr ../request-session-deploy.zip index.mjs)
   (cd get-languages && zip -qr ../get-languages-deploy.zip index.mjs)
   ```

4. Create an execution role for the functions (trust policy provided in [`trust-policy.json`](lambda-functions/trust-policy.json)) and attach the basic execution policy so the functions can write logs:

   ```bash
   aws iam create-role \
     --role-name deepl-v2v-lambda-role \
     --assume-role-policy-document file://trust-policy.json

   aws iam attach-role-policy \
     --role-name deepl-v2v-lambda-role \
     --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

   # Capture the role ARN for the next step
   ROLE_ARN=$(aws iam get-role --role-name deepl-v2v-lambda-role --query 'Role.Arn' --output text)
   ```

5. Create the two functions (Node.js 20.x, handler `index.handler`):

   ```bash
   aws lambda create-function \
     --function-name deepl-v2v-request-session \
     --runtime nodejs20.x \
     --handler index.handler \
     --role "$ROLE_ARN" \
     --zip-file fileb://request-session-deploy.zip \
     --timeout 30 \
     --region "$REGION"

   aws lambda create-function \
     --function-name deepl-v2v-get-languages \
     --runtime nodejs20.x \
     --handler index.handler \
     --role "$ROLE_ARN" \
     --zip-file fileb://get-languages-deploy.zip \
     --timeout 30 \
     --region "$REGION"
   ```

   > If you re-run this later to update the code, use `aws lambda update-function-code --function-name <name> --zip-file fileb://<zip> --region "$REGION"` instead of `create-function`.

6. Set the DeepL API key environment variables (see [Step 5b](#5b-configure-deepl-api-keys) for details on the keys):

   ```bash
   aws lambda update-function-configuration \
     --function-name deepl-v2v-request-session \
     --environment "Variables={DEEPL_API_KEY=your-prod-key,DEEPL_DEV_API_KEY=your-dev-key}" \
     --region "$REGION"

   aws lambda update-function-configuration \
     --function-name deepl-v2v-get-languages \
     --environment "Variables={DEEPL_API_KEY=your-prod-key}" \
     --region "$REGION"
   ```

7. Enable a public Function URL with CORS on each function (CORS config provided in [`cors-config.json`](lambda-functions/cors-config.json)), then grant public invoke permission:

   ```bash
   for FN in deepl-v2v-request-session deepl-v2v-get-languages; do
     aws lambda create-function-url-config \
       --function-name "$FN" \
       --auth-type NONE \
       --cors file://cors-config.json \
       --region "$REGION"

     aws lambda add-permission \
       --function-name "$FN" \
       --statement-id FunctionURLAllowPublicAccess \
       --action lambda:InvokeFunctionUrl \
       --principal "*" \
       --function-url-auth-type NONE \
       --region "$REGION"
   done
   ```

   > The demo uses `NONE` (unauthenticated) Function URLs, matching [`public-url-policy.json`](lambda-functions/public-url-policy.json), so the browser can call them directly. This means anyone with the URL can invoke your functions (and spend your DeepL quota). For anything beyond a demo, restrict access (e.g. `AWS_IAM` auth, a WAF, or an API Gateway in front).

8. Retrieve the two Function URLs — **save them**, you will need them in [Step 5c](#5c-wire-the-lambda-function-urls-into-the-webapp):

   ```bash
   aws lambda get-function-url-config --function-name deepl-v2v-request-session \
     --query 'FunctionUrl' --output text --region "$REGION"
   aws lambda get-function-url-config --function-name deepl-v2v-get-languages \
     --query 'FunctionUrl' --output text --region "$REGION"
   ```

### 5b. Configure DeepL API Keys

   - The Lambda functions from Step 5a require DeepL API keys, supplied as environment variables:
     - `DEEPL_API_KEY` - your **production** DeepL API key (used by both functions)
     - `DEEPL_DEV_API_KEY` - your **development** DeepL API key (used by `deepl-v2v-request-session` for dev-environment sessions)
   - If you already set these in Step 5a (step 6) you can skip this step. To set or update them later:
   - **Configure via AWS Console:**
     1. Open [AWS Lambda Console](https://console.aws.amazon.com/lambda)
     2. Select the `deepl-v2v-request-session` function
     3. Go to **Configuration** → **Environment variables** → **Edit**
     4. Add the following environment variables:
        - Key: `DEEPL_API_KEY`, Value: `[your production DeepL API key]`
        - Key: `DEEPL_DEV_API_KEY`, Value: `[your development DeepL API key]`
     5. Click **Save**
     6. Repeat for the `deepl-v2v-get-languages` function (it only needs `DEEPL_API_KEY`)
   - **Or configure via AWS CLI:**
     ```bash
     aws lambda update-function-configuration \
       --function-name deepl-v2v-request-session \
       --environment "Variables={DEEPL_API_KEY=your-prod-key,DEEPL_DEV_API_KEY=your-dev-key}"

     aws lambda update-function-configuration \
       --function-name deepl-v2v-get-languages \
       --environment "Variables={DEEPL_API_KEY=your-prod-key}"
     ```
   - **Environment Switching:** The demo supports switching between dev and prod environments in debug mode (`?debug=true`). Production environment is used by default.

### 5c. Wire the Lambda Function URLs into the webapp

The webapp reads the two Function URLs from build-time environment variables. You must provide the URLs from Step 5a and rebuild/redeploy the webapp.

> **Do not skip this step.** If these variables are missing, the webapp falls back to hard-coded URLs baked into [`webapp/adapters/voiceToVoiceAdapter.js`](webapp/adapters/voiceToVoiceAdapter.js) that point at a **different AWS account** — your demo would silently use someone else's Lambda functions and DeepL quota. Always point these at the functions you deployed.

1. In your terminal, navigate to the `webapp` folder and create a `.env` file from the example:

   ```bash
   cd connect-v2v-translation-with-cx-options/webapp
   cp .env.example .env
   ```

2. Edit `.env` and set both values to the Function URLs you saved in Step 5a:

   ```bash
   VITE_GET_LANGUAGES_PROXY=https://<your-get-languages-id>.lambda-url.<region>.on.aws/
   VITE_REQUEST_SESSION_PROXY=https://<your-request-session-id>.lambda-url.<region>.on.aws/
   ```

3. Rebuild and redeploy the webapp so the new URLs are baked into the deployed build:

   ```bash
   cd ../cdk-stacks
   npm run build:deploy:all
   ```
   - **On Windows devices use `npm run build:deploy:all:gitbash`.**

6. Configure Amazon Connect Approved Origins

- Login into your AWS Console
- Navigate to Amazon Connect -> Your instance alias -> Approved origins
- Click **Add Domain**
- Enter the domain of your web application, in this case Amazon CloudFront Distribution URL. For instance: `https://aaaabbbbcccc.cloudfront.net`
- Click **Add Domain**

7. Create Cognito User

   - To create an Amazon Cognito user, you'll need Cognito User Pool Id (created in step 5 - check for the AWS CDK Output, or check it in your AWS Console > Cognito User Pools)
   - Create an Amazon Cognito user either user directly in the [Cognito Console](https://docs.aws.amazon.com/cognito/latest/developerguide/how-to-create-user-accounts.html#creating-a-new-user-using-the-users-tab) or by executing:
     `aws cognito-idp admin-create-user --region <<yourDesiredRegion>> --user-pool-id <<yourUserPoolId>>  --username <<yourEmailAddress>> --user-attributes "Name=name,Value=<<YourName>>" --desired-delivery-mediums EMAIL`
   - You will receive an email, with a temporary password, which you will need in step 7
     **You can repeat this step for each person you want to give access to either now or at a later date.**

8. Configure Cognito Callback and Logout URLs

   - In your terminal, navigate to `connect-v2v-translation-with-cx-options/cdk-stacks`
   - Start the configuration script in interactive mode  
     `npm run configure`
   - The script loads all the existing parameters, and prompts for new parameters to be provided
   - Accept all the existing parameters, but provide a new value for:
     - `cognito-callback-urls`: Domain of your web application, in this case Amazon CloudFront Distribution URL. For instance: `https://aaaabbbbcccc.cloudfront.net`
     - `cognito-logout-urls`: Domain of your web application, in this case Amazon CloudFront Distribution URL. For instance: `https://aaaabbbbcccc.cloudfront.net`
     - For the Demo / Development purposes, you can configure both the previously entered `https://localhost:5173` and Amazon CloudFront Distribution URL (comma separated)
   - The script stores the deployment parameters to AWS System Manager Parameter Store
   - While in `connect-v2v-translation-with-cx-options/cdk-stacks`, run the deploy script: `npm run cdk:deploy`
     - **On Windows devices use `npm run cdk:deploy:gitbash`**.
   - Wait for the CDK stacks to be updated

9. Test the solution
   - Open your browser and navigate to Amazon CloudFront Distribution URL (Output to the console and also available in the Outputs of the Frontend Cloudformation Stack)
   - On the Cognito Login screen, provide your email address and temporary password you received via email
   - If logging in the first time you will be prompted to reset your password.
   - If not already logged in Amazon Connect CCP, you will need to provide your Amazon Connect Agent username and password (For Demo purposes, Amazon Cognito and Amazon Connect are not integrated)
   - You should now see Amazon Connect CCP and Voice to Voice (V2V) controls
   - To proceed with the demo, please check the **Custom UI Demo Guide** section

## Test Webapp locally

To be able to make changes in the Webapp and test them locally, without re-deploying the Webapp to Amazon CloudFront, please follow these steps:

1. In your terminal, navigate to `connect-v2v-translation-with-cx-options/cdk-stacks`
2. Synchronise the Webapp config parameters: `npm run sync-config`
3. This script will download `frontend-config.js` to the `webapp` folder
4. In your terminal, navigate to `connect-v2v-translation-with-cx-options/webapp`
5. To start the Webapp: `npm run dev`
6. This script starts a local Vite server on port 5173
7. Open your browser and navigate to `https://localhost:5173`
8. You can make changes and customize Webapp files, with browser automatically reloading the Webapp
9. Please make sure you add `https://localhost:5173` as Amazon Connect Approved Origin (see Step 6 in **Solution setup** -> **Configure Amazon Connect Approved Origins**)
10. Once happy with the changes, navigate to `connect-v2v-translation-with-cx-options/cdk-stacks` and `npm run build:deploy:all` (On Windows devices use `npm run build:deploy:all:gitbash`)

## Clean up

To remove the solution from your account, please follow these steps:

1. Remove CDK Stacks

   - Run `cdk destroy --all`

2. Remove deployment parameters from AWS System Manager Parameter Store
   - Run `npm run configure:delete`

## Demo Webapp key components

- **Adapters** - allow communication with AWS Services, abstracting AWS SDK specifics from the application business logic:
  - **Transcribe Adapter** - allows Amazon Transcribe client to be reused across requests, and provides provides separate Amazon Transcribe clients for agent's and customer's audio transcription
  - **Polly Adapter** - allows Amazon Polly client to be reused across requests, and allows Amazon CloudFront to act as a reverse proxy for Amazon Polly
  - **Translate Adapter** - allows Amazon Translate client to be reused across requests and allows Amazon CloudFront to act as a reverse proxy for Amazon Translate
- **Managers** - abstracts audio streaming specifics from the application business logic:
  - **Audio Stream Manager** - allows simple management and mixing of different audio streams, such as file, mic, translated voice etc.
    - `ToCustomerAudioStreamManager` is attached to **To Customer** audio element and controls what customer hears
    - `ToAgentAudioStreamManager` is attached to **To Agent** audio element and controls what agent hears
  - **Session Track Manager** - abstracts Amazon Connect WebRTC Media Streaming management
    - uses Amazon Connect SoftphoneManager (from Amazon Connect Streams JS / Amazon Connect RTC JS)
    - to set/replace current audio track in the currently active WebRTC PeerConnection
