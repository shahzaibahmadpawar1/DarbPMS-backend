$ErrorActionPreference = 'Stop'
$base = 'http://localhost:5000'

function Login($u, $p) {
    $res = Invoke-RestMethod -Uri "$base/api/auth/login" -Method Post -ContentType 'application/json' -Body (@{ username = $u; password = $p } | ConvertTo-Json)
    return $res
}

function Api($method, $path, $token, $body) {
    $headers = @{ Authorization = "Bearer $token" }
    if ($null -ne $body) {
        return Invoke-RestMethod -Uri "$base$path" -Method $method -Headers $headers -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 8)
    }
    return Invoke-RestMethod -Uri "$base$path" -Method $method -Headers $headers
}

function ApiStatus($method, $path, $token, $body) {
    $headers = @{ Authorization = "Bearer $token" }
    try {
        if ($null -ne $body) {
            $resp = Invoke-WebRequest -Uri "$base$path" -Method $method -Headers $headers -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 8)
        }
        else {
            $resp = Invoke-WebRequest -Uri "$base$path" -Method $method -Headers $headers
        }

        return @{ ok = $true; status = [int]$resp.StatusCode; body = $resp.Content }
    }
    catch {
        if ($_.Exception.Response) {
            $r = $_.Exception.Response
            $stream = $r.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $txt = $reader.ReadToEnd()
            return @{ ok = $false; status = [int]$r.StatusCode; body = $txt }
        }

        return @{ ok = $false; status = 0; body = $_.Exception.Message }
    }
}

$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$reqLogin = Login 'e2e_requester' 'Pass123!'
$mgrLogin = Login 'e2e_quality_manager' 'Pass123!'
$empLogin = Login 'e2e_quality_employee' 'Pass123!'

$requesterToken = $reqLogin.token
$managerToken = $mgrLogin.token
$employeeToken = $empLogin.token
$employeeId = $empLogin.user.id

$summary = [ordered]@{}

$sub0 = "E2E zero stations $ts"
$r0 = Api 'Post' '/api/requests/submit' $requesterToken @{ department = 'quality'; requestType = 'inspection'; priority = 'medium'; subject = $sub0; description = 'zero stations test'; dueDate = $null; stationCodes = @() }
$id0 = $r0.data.id
$summary.zeroStationSubmit = @{ taskId = $id0; stationCount = $r0.data.metadata.stationCodes.Count; status = $r0.data.status }

$sub1 = "E2E one station $ts"
$r1 = Api 'Post' '/api/requests/submit' $requesterToken @{ department = 'quality'; requestType = 'survey-report'; priority = 'high'; subject = $sub1; description = 'one station test'; stationCodes = @('E2E-ST-001') }
$id1 = $r1.data.id
$summary.oneStationSubmit = @{ taskId = $id1; stationCount = $r1.data.metadata.stationCodes.Count; status = $r1.data.status }

$sub2 = "E2E multi stations $ts"
$r2 = Api 'Post' '/api/requests/submit' $requesterToken @{ department = 'quality'; requestType = 'site-visit'; priority = 'low'; subject = $sub2; description = 'multi station test'; stationCodes = @('E2E-ST-001', 'E2E-ST-002') }
$id2 = $r2.data.id
$summary.multiStationSubmit = @{ taskId = $id2; stationCount = $r2.data.metadata.stationCodes.Count; status = $r2.data.status }

$mgrDirect = Api 'Patch' "/api/tasks/$id0/review" $managerToken @{ decision = 'approved'; comment = 'manager direct response'; attachmentUrl = 'https://example.com/e2e-direct.pdf' }
$summary.managerDirect = @{ taskId = $id0; status = $mgrDirect.data.status }

$reqAccept = Api 'Patch' "/api/tasks/$id0/requester-decision" $requesterToken @{ decision = 'accept'; comment = 'accepted by requester' }
$summary.requesterAccept = @{ taskId = $id0; status = $reqAccept.data.status }

$assign = Api 'Patch' "/api/tasks/$id1/assign" $managerToken @{ assignedToUserId = $employeeId; targetDepartment = 'quality'; assigneeNote = 'please handle' }
$empSubmit = Api 'Patch' "/api/tasks/$id1/employee-submit" $employeeToken @{ note = 'employee provided response' }
$mgrValidate = Api 'Patch' "/api/tasks/$id1/manager-validate" $managerToken @{ comment = 'validated and sent to requester' }
$reqDecline = Api 'Patch' "/api/tasks/$id1/requester-decision" $requesterToken @{ decision = 'decline'; comment = 'declined by requester' }
$summary.delegationFlow = @{ taskId = $id1; assignStatus = $assign.data.status; employeeSubmitStatus = $empSubmit.data.status; managerValidateStatus = $mgrValidate.data.status; requesterDecisionStatus = $reqDecline.data.status }

$sub3 = "E2E attachment limit $ts"
$r3 = Api 'Post' '/api/requests/submit' $requesterToken @{ department = 'quality'; requestType = 'inspection'; priority = 'medium'; subject = $sub3; description = 'attachment limit test'; stationCodes = @() }
$id3 = $r3.data.id
$assign3 = Api 'Patch' "/api/tasks/$id3/assign" $managerToken @{ assignedToUserId = $employeeId; targetDepartment = 'quality'; assigneeNote = 'attachment test' }
$empWithAttachment = Api 'Patch' "/api/tasks/$id3/employee-submit" $employeeToken @{ note = 'employee attached'; attachmentUrl = 'https://example.com/one.pdf' }
$limitCheck = ApiStatus 'Patch' "/api/tasks/$id3/manager-validate" $managerToken @{ comment = 'manager tries different attachment'; attachmentUrl = 'https://example.com/two.pdf' }
$summary.attachmentLimit = @{ taskId = $id3; employeeSubmitStatus = $empWithAttachment.data.status; managerValidateSecondAttachmentStatus = $limitCheck.status; managerValidateSecondAttachmentOk = $limitCheck.ok; managerValidateSecondAttachmentBody = $limitCheck.body }

$reqTasks = (Api 'Get' '/api/tasks' $requesterToken $null).data
$t0 = $reqTasks | Where-Object { $_.id -eq $id0 } | Select-Object -First 1
$t1 = $reqTasks | Where-Object { $_.id -eq $id1 } | Select-Object -First 1
$t2 = $reqTasks | Where-Object { $_.id -eq $id2 } | Select-Object -First 1
$summary.stationMetadataVerification = @{ zero = [int]$t0.metadata.stationCodes.Count; one = [int]$t1.metadata.stationCodes.Count; multi = [int]$t2.metadata.stationCodes.Count }

$summary | ConvertTo-Json -Depth 8
