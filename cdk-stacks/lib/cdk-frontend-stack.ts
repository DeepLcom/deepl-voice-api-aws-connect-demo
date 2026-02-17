// Copyright 2025 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as lambda from "aws-cdk-lib/aws-lambda";

import { FrontendS3DeploymentStack } from "../lib/frontend/frontend-s3-deployment-stack";
import { FrontendConfigStack } from "./frontend/frontend-config-stack";
import { loadSSMParams } from "../config/ssm-params-util";

const configParams = require("../config/config.params.json");

export interface CdkFrontendStackProps extends cdk.StackProps {
  readonly backendStackOutputs: { key: string; value: string }[];
}

export class CdkFrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CdkFrontendStackProps) {
    super(scope, id, props);

    //store physical stack name to SSM
    const outputHierarchy = `${configParams.hierarchy}outputParameters`;
    const cdkFrontendStackName = new ssm.StringParameter(this, "CdkFrontendStackName", {
      parameterName: `${outputHierarchy}/CdkFrontendStackName`,
      stringValue: this.stackName,
    });

    const ssmParams = loadSSMParams(this);

    //create webapp bucket
    const webAppBucket = new s3.Bucket(this, "WebAppBucket", {
      bucketName: `${configParams["CdkAppName"]}-WebAppBucket-${this.account}-${this.region}`.toLowerCase(),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const webAppLogBucket = new s3.Bucket(this, "WebAppLogBucket", {
      bucketName: `${configParams["CdkAppName"]}-WebAppLogBucket-${this.account}-${this.region}`.toLowerCase(),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      accessControl: s3.BucketAccessControl.LOG_DELIVERY_WRITE,
    });

    const frontendS3DeploymentStack = new FrontendS3DeploymentStack(this, "FrontendS3DeploymentStack", {
      cdkAppName: configParams["CdkAppName"],
      webAppBucket: webAppBucket,
    });

    const webAppCloudFrontDistribution = new cloudfront.Distribution(this, `${configParams["CdkAppName"]}-WebAppDistribution`, {
      comment: `CloudFront for ${configParams["CdkAppName"]}`,
      enableIpv6: false,
      enableLogging: true,
      logBucket: webAppLogBucket,
      logIncludesCookies: false,
      logFilePrefix: "cloudfront-logs/",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webAppBucket, {
          originPath: `/${configParams["WebAppRootPrefix"].replace(/\/$/, "")}`,
        }),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(60),
        },
      ],
    });

    //create frontend config
    const frontendConfigStack = new FrontendConfigStack(this, "FrontendConfigStack", {
      cdkAppName: configParams["CdkAppName"],
      webAppBucket: webAppBucket,
      backendStackOutputs: props.backendStackOutputs,
    });

    //create amazon-polly-proxy
    if (ssmParams.pollyProxyEnabled) {
      webAppCloudFrontDistribution.addBehavior(
        "/amazon-polly-proxy/*",
        new origins.HttpOrigin(`polly.${ssmParams.pollyRegion}.amazonaws.com`, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        }),
        {
          cachePolicy: new cloudfront.CachePolicy(this, "PollyApiCachePolicy", {
            defaultTtl: cdk.Duration.seconds(0), // Don't cache by default
            minTtl: cdk.Duration.seconds(0),
            maxTtl: cdk.Duration.seconds(1),
            enableAcceptEncodingBrotli: true,
            enableAcceptEncodingGzip: true,
            headerBehavior: cloudfront.CacheHeaderBehavior.allowList("authorization", "content-type"),
          }),
          originRequestPolicy: new cloudfront.OriginRequestPolicy(this, "PollyApiOriginRequestPolicy", {
            headerBehavior: cloudfront.OriginRequestHeaderBehavior.denyList("host"),
            queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
            cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
          }),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          compress: true,
          functionAssociations: [
            {
              function: new cloudfront.Function(this, "PollyUrlRewrite", {
                code: cloudfront.FunctionCode.fromInline(`
                        function handler(event) {
                            var request = event.request;
                            var uri = request.uri;
                            if (uri.startsWith('/amazon-polly-proxy')) {
                                uri = uri.replace('/amazon-polly-proxy', '');
                                if (!uri.startsWith('/')) {
                                    uri = '/' + uri;
                                }
                                request.uri = uri;
                            }
                            return request;
                        }
                    `),
                runtime: cloudfront.FunctionRuntime.JS_2_0,
              }),
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        }
      );
    }

    //create amazon-translate-proxy
    if (ssmParams.translateProxyEnabled) {
      webAppCloudFrontDistribution.addBehavior(
        "/amazon-translate-proxy/*",
        new origins.HttpOrigin(`translate.${ssmParams.translateRegion}.amazonaws.com`, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        }),
        {
          cachePolicy: new cloudfront.CachePolicy(this, "TranslateApiCachePolicy", {
            defaultTtl: cdk.Duration.seconds(0), // Don't cache by default
            minTtl: cdk.Duration.seconds(0),
            maxTtl: cdk.Duration.seconds(1),
            enableAcceptEncodingBrotli: true,
            enableAcceptEncodingGzip: true,
            headerBehavior: cloudfront.CacheHeaderBehavior.allowList("authorization", "content-type"),
          }),
          originRequestPolicy: new cloudfront.OriginRequestPolicy(this, "TranslateApiOriginRequestPolicy", {
            headerBehavior: cloudfront.OriginRequestHeaderBehavior.denyList("host"),
            queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.none(),
            cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
          }),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          compress: true,
          functionAssociations: [
            {
              function: new cloudfront.Function(this, "TranslateUrlRewrite", {
                code: cloudfront.FunctionCode.fromInline(`
                        function handler(event) {
                            var request = event.request;
                            var uri = request.uri;
                            if (uri.startsWith('/amazon-translate-proxy')) {
                                uri = uri.replace('/amazon-translate-proxy', '');
                                if (!uri.startsWith('/')) {
                                    uri = '/' + uri;
                                }
                                request.uri = uri;
                            }
                            return request;
                        }
                    `),
                runtime: cloudfront.FunctionRuntime.JS_2_0,
              }),
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        }
      );
    }

    /**************************************************************************************************************
     * CDK Outputs *
     **************************************************************************************************************/

    new cdk.CfnOutput(this, "webAppBucket", {
      value: webAppBucket.bucketName,
    });

    new cdk.CfnOutput(this, "webAppURL", {
      value: `https://${webAppCloudFrontDistribution.distributionDomainName}`,
    });
  }
}
