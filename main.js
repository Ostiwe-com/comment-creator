const core = require('@actions/core');
const github = require('@actions/github');
import fetch from 'cross-fetch';


function getInputs() {
    return {
        allowRepeats: core.getInput('allow-repeats') === 'true',
        linterInput: core.getInput('linterInput'),
        token: core.getInput('token'),
        repoTokenUserLogin: core.getInput('repo-token-user-login') || 'github-actions[bot]',
    }
}


function getMessage(ruleID, ruleMessage, lineStart, lineEnd) {
    return `
            Rule: ${ruleID}
            Message: ${ruleMessage}
            Lines: ${lineStart} - ${lineEnd}
    `;
}

function prepareComments(linterResults = []) {
    const filtered = linterResults.filter((linterRule) => {
        return Object.keys(linterRule).includes('messages') && linterRule.messages.length !== 0
    })

    const data = []

    core.debug("Prepared messages: " + filtered.length)

    filtered.forEach((linterRule) => {
        const items = linterRule.messages.map((linterMessage) => {
            return {
                path: linterRule.filePath,
                text: getMessage(linterMessage.ruleId, linterMessage.message, `${linterMessage.line}:${linterMessage.column}`, `${linterMessage.endLine}:${linterMessage.endColumn}`),
                line: linterMessage.line,
            }
        })

        data.push(...items)
    })


    return data
}

function setOutputs(createdComments) {
    core.setOutput('comments-created-all', createdComments.every(x => x))
    core.setOutput('comments-created-some', createdComments.some(x => x))
    core.setOutput('comments-created-list', JSON.stringify(createdComments))
}

async function execute() {
    const {linterInput, token} = getInputs()

    core.debug("LINTER INPUT: " + linterInput)
    core.debug("LINTER INPUT TYPE: " + typeof linterInput)

    const jsonData = JSON.parse(linterInput)

    if (!Object.keys(jsonData).includes('id')) {
        throw new Error('no past id provided')
    }

    const lintResultResponse = await fetch(`https://past.ostiwe.com/${jsonData.id}`);
    const lintResult = await lintResultResponse.json()


    const comments = prepareComments(lintResult)

    core.debug("Comments to create: " + JSON.stringify(comments))

    let commentsCreated = comments.map(() => false)

    if (!token) {
        throw new Error(
            'no github token provided, set one with the token input or GITHUB_TOKEN env variable'
        )
    }

    const {
        payload: {pull_request: pullRequest, repository},
        sha
    } = github.context

    core.debug("pullRequest " + JSON.stringify(pullRequest))
    core.debug("repository " + JSON.stringify(repository))

    if (!repository) {
        core.info('unable to determine repository from request type')
        setOutputs(commentsCreated)
        return
    }

    const [owner, repo] = repository.full_name.split('/')

    let commitSha
    let prNumber

    if (pullRequest && pullRequest.number) {
        prNumber = pullRequest.number
        commitSha = pullRequest.head.sha
    } else {
        core.info('this action only works on pull_request events')
        setOutputs(commentsCreated)
        return
    }

    commentsCreated = []
    for (const c of comments) {
        const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments`
        const body = {
            body: c.text,
            commit_id: commitSha,
            path: c.path,
            line: c.line,
            side: c.side || 'RIGHT',
        }

        core.debug("Create comment to url '" + url + "' with body: " + JSON.stringify(body))

        const res = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer: ${token}`
            },
            body: JSON.stringify(body)
        })

        const createCommentResponse = await res.json()

        core.debug('Create comment request response: ' + JSON.stringify(createCommentResponse))
    }

    setOutputs(commentsCreated)
}

execute().catch((err) => {
    console.log(err)
    core.setFailed(err.message)
})
