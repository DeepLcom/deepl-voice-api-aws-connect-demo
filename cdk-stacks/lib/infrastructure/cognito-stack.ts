// Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";

export interface CognitoStackProps extends cdk.NestedStackProps {
  readonly SSMParams: any;
  readonly cdkAppName: string;
}

export class CognitoStack extends cdk.NestedStack {
  public readonly authenticatedRole: iam.IRole;

  public readonly identityPool: cognito.CfnIdentityPool;
  public readonly userPool: cognito.IUserPool;
  public readonly userPoolClient: cognito.IUserPoolClient;
  public readonly userPoolDomain: cognito.CfnUserPoolDomain;

  constructor(scope: Construct, id: string, props: CognitoStackProps) {
    super(scope, id, props);

    //create a User Pool
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `${props.cdkAppName}-UserPool`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      signInAliases: {
        username: false,
        phone: false,
        email: true,
      },
      standardAttributes: {
        email: {
          required: false, //Cognito bug with federation - If you make a user pool with required email field then the second login attempt fails (https://github.com/aws-amplify/amplify-js/issues/3526)
          mutable: true,
        },
      },
      customAttributes: {
        connectUserId: new cognito.StringAttribute({ minLen: 36, maxLen: 36, mutable: true }),
      },
      userInvitation: {
        emailSubject: `Your ${props.SSMParams.CdkAppName} temporary password`,
        emailBody: `Your ${props.SSMParams.CdkAppName} username is {username} and temporary password is {####}`,
      },
      userVerification: {
        emailSubject: `Verify your new ${props.SSMParams.CdkAppName} account`,
        emailBody: `The verification code to your new ${props.SSMParams.CdkAppName} account is {####}`,
      },
    });

    //SAML Federation
    let supportedIdentityProviders: cognito.UserPoolClientIdentityProvider[] = [];
    let userPoolClientOAuthConfig: cognito.OAuthSettings = {
      scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.COGNITO_ADMIN, cognito.OAuthScope.PROFILE],
    };

    //Enable Cognito Managed Login Pages
    supportedIdentityProviders.push(cognito.UserPoolClientIdentityProvider.COGNITO);

    //create a User Pool Client
    const userPoolClient = new cognito.UserPoolClient(this, "UserPoolClient", {
      userPool: userPool,
      userPoolClientName: props.SSMParams.CdkFrontendStack,
      generateSecret: false,
      supportedIdentityProviders: supportedIdentityProviders,
      oAuth: {
        ...userPoolClientOAuthConfig,
        callbackUrls: props.SSMParams.cognitoCallbackUrls.split(",").map((item: string) => item.trim()),
        logoutUrls: props.SSMParams.cognitoLogoutUrls.split(",").map((item: string) => item.trim()),
      },
    });

    const userPoolDomain = new cognito.CfnUserPoolDomain(this, "UserPoolDomain", {
      domain: props.SSMParams.cognitoDomainPrefix,
      userPoolId: userPool.userPoolId,
    });

    //create an Identity Pool
    const identityPool = new cognito.CfnIdentityPool(this, "IdentityPool", {
      identityPoolName: `${props.cdkAppName}-IdentityPool`,
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: userPoolClient.userPoolClientId,
          providerName: userPool.userPoolProviderName,
        },
      ],
    });

    //Cognito Identity Pool Roles
    const unauthenticatedRole = new iam.Role(this, "CognitoDefaultUnauthenticatedRole", {
      assumedBy: new iam.FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          StringEquals: { "cognito-identity.amazonaws.com:aud": identityPool.ref },
          "ForAnyValue:StringLike": { "cognito-identity.amazonaws.com:amr": "unauthenticated" },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
    });

    unauthenticatedRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["mobileanalytics:PutEvents", "cognito-sync:*"],
        resources: ["*"],
      })
    );

    const authenticatedRole = new iam.Role(this, "CognitoDefaultAuthenticatedRole", {
      assumedBy: new iam.FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          StringEquals: { "cognito-identity.amazonaws.com:aud": identityPool.ref },
          "ForAnyValue:StringLike": { "cognito-identity.amazonaws.com:amr": "authenticated" },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
    });

    authenticatedRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "mobileanalytics:PutEvents",
          "cognito-sync:*",
          "cognito-identity:*",
          "polly:SynthesizeSpeech",
          "polly:DescribeVoices",
          "transcribe:StartStreamTranscription",
          "transcribe:StartStreamTranscriptionWebSocket",
          "translate:ListLanguages",
          "translate:TranslateText",
          "cognito-identity:GetCredentialsForIdentity",
        ],
        resources: ["*"],
      })
    );

    const defaultPolicy = new cognito.CfnIdentityPoolRoleAttachment(this, "DefaultValid", {
      identityPoolId: identityPool.ref,
      roles: {
        unauthenticated: unauthenticatedRole.roleArn,
        authenticated: authenticatedRole.roleArn,
      },
    });

    this.authenticatedRole = authenticatedRole;

    /**************************************************************************************************************
     * Stack Outputs *
     **************************************************************************************************************/

    this.identityPool = identityPool;
    this.userPool = userPool;
    this.userPoolClient = userPoolClient;
    this.userPoolDomain = userPoolDomain;
  }
}
