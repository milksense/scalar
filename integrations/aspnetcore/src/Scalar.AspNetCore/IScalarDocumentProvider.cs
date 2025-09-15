using Microsoft.AspNetCore.Http;

namespace Scalar.AspNetCore;

internal interface IScalarDocumentProvider
{
    Task<string> GetDocumentContentAsync(string documentName, HttpContext httpContext, CancellationToken cancellationToken);
}