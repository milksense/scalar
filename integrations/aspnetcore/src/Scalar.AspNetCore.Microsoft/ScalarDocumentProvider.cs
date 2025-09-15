using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Scalar.AspNetCore.Microsoft;

#if NET10_0_OR_GREATER
internal sealed class ScalarDocumentProvider : IScalarDocumentProvider
{
    public async Task<string> GetDocumentContentAsync(string documentName, HttpContext httpContext, CancellationToken cancellationToken)
    {
        var documentProvider = httpContext.RequestServices.GetKeyedService<IOpenApiDocumentProvider>(documentName);
        var openApiOptions = httpContext.RequestServices.GetRequiredService<IOptionsSnapshot<OpenApiOptions>>().Get(documentName);
        if (documentProvider is null)
        {
            throw new InvalidOperationException($"No OpenAPI document provider found for document name '{documentName}'.");
        }

        var document = await documentProvider.GetOpenApiDocumentAsync(cancellationToken);
        return await document.SerializeAsJsonAsync(openApiOptions.OpenApiVersion, cancellationToken);
    }
}

#endif