using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.OpenApi.Extensions;
using Swashbuckle.AspNetCore.Swagger;

namespace Scalar.AspNetCore.Swashbuckle;

internal sealed class ScalarDocumentProvider : IScalarDocumentProvider
{
    public async Task<string> GetDocumentContentAsync(string documentName, HttpContext httpContext, CancellationToken cancellationToken)
    {
        var documentProvider = httpContext.RequestServices.GetRequiredService<IAsyncSwaggerProvider>();
        var swaggerOptions = httpContext.RequestServices.GetRequiredService<IOptions<SwaggerOptions>>().Value;
        var document = await documentProvider.GetSwaggerAsync(documentName);

        // One last opportunity to modify the Swagger Document - this time with request context
        foreach (var filter in swaggerOptions.PreSerializeFilters)
        {
            filter(document, httpContext.Request);
        }

        return document.SerializeAsJson(swaggerOptions.OpenApiVersion);
    }
}